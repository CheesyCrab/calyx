//! Audible `tone` presenter.
//!
//! The verified artifact is still [`AudioEvent`]: this module is a dumb,
//! deliberately unverified sink. [`ToneSynth`] is pure presenter-side PCM
//! generation and [`Speaker`] only connects it to the platform callback.
//! SDL2 reuses `ToneSynth` without inheriting cpal.

use calyx_core::AudioEvent;

use crate::timing::SIM_HZ;

const VOICES: usize = 4;
const MIX_GAIN: f32 = 0.20;

#[derive(Clone, Copy, Debug, Default)]
struct Voice {
    wave: u8,
    phase: f64,
    phase_step: f64,
    remaining: u64,
    volume: f32,
    noise: u32,
    noise_value: f32,
}

/// Four-channel, simulation-tick-clocked beeper synthesis.
///
/// `render_frame` always emits exactly one 60 Hz cart tick of mono PCM. A rational
/// accumulator handles sample rates that are not divisible by 60,
/// so durations remain frame-quantized without wall-clock drift.
pub struct ToneSynth {
    sample_rate: u32,
    sample_acc: u64,
    voices: [Voice; VOICES],
}

impl ToneSynth {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate: sample_rate.max(1),
            sample_acc: 0,
            voices: [Voice::default(); VOICES],
        }
    }

    pub fn reset(&mut self) {
        self.sample_acc = 0;
        self.voices = [Voice::default(); VOICES];
    }

    pub fn render_frame(&mut self, events: &[AudioEvent]) -> Vec<f32> {
        for event in events {
            self.trigger(event);
        }

        self.sample_acc += u64::from(self.sample_rate);
        let count = (self.sample_acc / u64::from(SIM_HZ)) as usize;
        self.sample_acc %= u64::from(SIM_HZ);

        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            let mut mixed = 0.0;
            for voice in &mut self.voices {
                if voice.remaining == 0 {
                    continue;
                }
                mixed += sample_voice(voice) * voice.volume * MIX_GAIN;
                voice.remaining -= 1;
            }
            out.push(mixed.clamp(-1.0, 1.0));
        }
        out
    }

    fn trigger(&mut self, event: &AudioEvent) {
        let channel = ((event.flags >> 2) & 3) as usize;
        let wave = (event.flags & 3) as u8;
        let duration =
            ((i64::from(event.dur.max(0)) * i64::from(self.sample_rate) + i64::from(SIM_HZ) - 1)
                / i64::from(SIM_HZ)) as u64;
        let freq = event.freq.max(0) as f64;
        self.voices[channel] = Voice {
            wave,
            phase: 0.0,
            phase_step: freq / f64::from(self.sample_rate),
            remaining: duration,
            volume: event.vol.clamp(0, 100) as f32 / 100.0,
            noise: 0x6d2b_79f5 ^ (channel as u32).wrapping_mul(0x9e37_79b9),
            noise_value: 0.0,
        };
    }
}

fn sample_voice(voice: &mut Voice) -> f32 {
    let phase = voice.phase;
    let value = match voice.wave {
        0 => {
            if phase < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        1 => (1.0 - 4.0 * (phase - 0.5).abs()) as f32,
        2 => (phase * std::f64::consts::TAU).sin() as f32,
        3 => {
            // Noise changes at the requested frequency, rather than at the
            // device sample rate, so low drum frequencies stay textured.
            if phase == 0.0 || phase + voice.phase_step >= 1.0 {
                let mut x = voice.noise;
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                voice.noise = x;
                voice.noise_value = if x & 1 == 0 { -1.0 } else { 1.0 };
            }
            voice.noise_value
        }
        _ => 0.0,
    };
    voice.phase = (phase + voice.phase_step).fract();
    value
}

#[cfg(feature = "audio")]
mod device {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{SampleFormat, Stream};

    /// Non-blocking platform speaker. Queue contention or device failure
    /// produces silence; it can never stall or fault the cart loop.
    pub struct Speaker {
        _stream: Stream,
        synth: ToneSynth,
        queue: Arc<Mutex<VecDeque<f32>>>,
        max_queued: usize,
    }

    impl Speaker {
        pub fn open() -> Result<Self, String> {
            let host = cpal::default_host();
            let device = host
                .default_output_device()
                .ok_or_else(|| "no default output device".to_string())?;
            let supported = device
                .default_output_config()
                .map_err(|e| format!("default output config: {e}"))?;
            let sample_rate = supported.sample_rate();
            let channels = usize::from(supported.channels());
            let config = supported.config();
            let queue = Arc::new(Mutex::new(VecDeque::new()));
            let callback_queue = queue.clone();
            let err = |e| eprintln!("audio: output stream error: {e}");

            let stream = match supported.sample_format() {
                SampleFormat::F32 => device.build_output_stream(
                    config,
                    move |data: &mut [f32], _| fill_f32(data, channels, &callback_queue),
                    err,
                    None,
                ),
                SampleFormat::I16 => device.build_output_stream(
                    config,
                    move |data: &mut [i16], _| fill_i16(data, channels, &callback_queue),
                    err,
                    None,
                ),
                SampleFormat::U16 => device.build_output_stream(
                    config,
                    move |data: &mut [u16], _| fill_u16(data, channels, &callback_queue),
                    err,
                    None,
                ),
                format => return Err(format!("unsupported output sample format {format}")),
            }
            .map_err(|e| format!("build output stream: {e}"))?;
            stream
                .play()
                .map_err(|e| format!("start output stream: {e}"))?;

            Ok(Self {
                _stream: stream,
                synth: ToneSynth::new(sample_rate),
                queue,
                max_queued: sample_rate as usize / 2,
            })
        }

        pub fn frame(&mut self, events: &[AudioEvent]) {
            let samples = self.synth.render_frame(events);
            let Ok(mut queue) = self.queue.try_lock() else {
                return;
            };
            // If presentation fell behind, discard stale glass-side audio
            // rather than allowing an unbounded queue to affect the host.
            let overflow = queue
                .len()
                .saturating_add(samples.len())
                .saturating_sub(self.max_queued);
            let stale = overflow.min(queue.len());
            queue.drain(..stale);
            queue.extend(samples);
        }

        pub fn reset(&mut self) {
            self.synth.reset();
            if let Ok(mut queue) = self.queue.try_lock() {
                queue.clear();
            }
        }
    }

    fn fill_f32(data: &mut [f32], channels: usize, queue: &Arc<Mutex<VecDeque<f32>>>) {
        let Ok(mut queue) = queue.try_lock() else {
            data.fill(0.0);
            return;
        };
        for frame in data.chunks_mut(channels) {
            frame.fill(queue.pop_front().unwrap_or(0.0));
        }
    }

    fn fill_i16(data: &mut [i16], channels: usize, queue: &Arc<Mutex<VecDeque<f32>>>) {
        let Ok(mut queue) = queue.try_lock() else {
            data.fill(0);
            return;
        };
        for frame in data.chunks_mut(channels) {
            let sample =
                (queue.pop_front().unwrap_or(0.0).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            frame.fill(sample);
        }
    }

    fn fill_u16(data: &mut [u16], channels: usize, queue: &Arc<Mutex<VecDeque<f32>>>) {
        let Ok(mut queue) = queue.try_lock() else {
            data.fill(u16::MAX / 2);
            return;
        };
        for frame in data.chunks_mut(channels) {
            let sample = ((queue.pop_front().unwrap_or(0.0).clamp(-1.0, 1.0) * 0.5 + 0.5)
                * u16::MAX as f32) as u16;
            frame.fill(sample);
        }
    }
}

#[cfg(feature = "audio")]
pub use device::Speaker;

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: i32, dur: i32, vol: i32, wave: i32, channel: i32) -> AudioEvent {
        AudioEvent {
            freq,
            dur,
            vol,
            flags: wave | (channel << 2),
        }
    }

    #[test]
    fn frame_sample_counts_do_not_drift() {
        let mut synth = ToneSynth::new(44_100);
        let count: usize = (0..60).map(|_| synth.render_frame(&[]).len()).sum();
        assert_eq!(count, 44_100);
    }

    #[test]
    fn duration_is_quantized_in_cart_frames() {
        let mut synth = ToneSynth::new(600);
        let first = synth.render_frame(&[tone(10, 2, 100, 0, 0)]);
        let second = synth.render_frame(&[]);
        let third = synth.render_frame(&[]);
        assert!(first.iter().any(|s| *s != 0.0));
        assert!(second.iter().any(|s| *s != 0.0));
        assert!(third.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn all_waveforms_and_channels_mix_without_clipping() {
        let mut synth = ToneSynth::new(48_000);
        let events = (0..4)
            .map(|i| tone(220 + i * 110, 1, 100, i, i))
            .collect::<Vec<_>>();
        let pcm = synth.render_frame(&events);
        assert_eq!(pcm.len(), 800);
        assert!(pcm.iter().any(|s| *s != 0.0));
        assert!(pcm.iter().all(|s| (-1.0..=1.0).contains(s)));
    }

    #[test]
    fn retrigger_replaces_only_its_channel() {
        let mut synth = ToneSynth::new(600);
        synth.render_frame(&[tone(10, 10, 100, 0, 0), tone(20, 10, 100, 1, 1)]);
        synth.render_frame(&[tone(30, 1, 100, 2, 0)]);
        assert_eq!(synth.voices[0].wave, 2);
        assert_eq!(synth.voices[0].remaining, 0);
        assert!(synth.voices[1].remaining > 0);
    }

    #[test]
    fn reset_clears_active_voices_and_clock() {
        let mut synth = ToneSynth::new(44_100);
        synth.render_frame(&[tone(440, 20, 100, 0, 0)]);
        synth.reset();
        assert!(synth.render_frame(&[]).iter().all(|s| *s == 0.0));
    }
}
