//! Native simulation and presentation timing.
//!
//! Cart execution is always the ABI-pinned 60 Hz fixed step. Presentation is
//! a separate, deliberately smaller surface: native presenters may show every
//! tick (60 Hz) or every second tick (30 Hz).

use std::time::{Duration, Instant};

pub const SIM_HZ: u32 = 60;
pub const MAX_CATCHUP: u32 = 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PresentationRate {
    Hz30,
    Hz60,
}

impl PresentationRate {
    pub fn parse(raw: i32) -> Result<Self, String> {
        match raw {
            30 => Ok(Self::Hz30),
            60 => Ok(Self::Hz60),
            other => Err(format!(
                "--fps is presentation cadence and must be 30 or 60, got '{other}'"
            )),
        }
    }

    pub const fn fps(self) -> u32 {
        match self {
            Self::Hz30 => 30,
            Self::Hz60 => 60,
        }
    }

    pub const fn tick_stride(self) -> i32 {
        (SIM_HZ / self.fps()) as i32
    }

    /// Whether the framebuffer after `completed_ticks` should be presented.
    pub fn should_present(self, completed_ticks: i32) -> bool {
        completed_ticks > 0
            && match self {
                Self::Hz30 => (completed_ticks - 1) % self.tick_stride() == 0,
                Self::Hz60 => true,
            }
    }
}

/// Fixed 60 Hz simulation pacing: how many cart ticks are due at `now`.
/// Catch-up is capped; after a long stall, wall time is dropped rather than
/// changing the duration of a cart tick or entering a death spiral.
pub struct SimulationPacer {
    step: Duration,
    next: Instant,
}

impl SimulationPacer {
    pub fn new(now: Instant) -> Self {
        Self {
            step: Duration::from_nanos(1_000_000_000 / u64::from(SIM_HZ)),
            next: now,
        }
    }

    pub fn due(&mut self, now: Instant) -> u32 {
        let mut n = 0;
        while now >= self.next && n < MAX_CATCHUP {
            self.next += self.step;
            n += 1;
        }
        if n == MAX_CATCHUP && now >= self.next {
            self.next = now + self.step;
        }
        n
    }

    #[allow(dead_code)] // only the optional winit presenter waits on this deadline
    pub fn next_at(&self) -> Instant {
        self.next
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use calyx_core::{AudioEvent, Host};

    #[test]
    fn presentation_rates_never_change_sixty_tick_simulation() {
        for (rate, expected_presents) in
            [(PresentationRate::Hz30, 30), (PresentationRate::Hz60, 60)]
        {
            let presents = (1..=SIM_HZ as i32)
                .filter(|ticks| rate.should_present(*ticks))
                .count();
            assert_eq!(presents, expected_presents);
        }
    }

    #[test]
    fn thirty_hz_presents_the_first_completed_tick_then_alternates() {
        let rate = PresentationRate::Hz30;
        assert!(rate.should_present(1));
        assert!(!rate.should_present(2));
        assert!(rate.should_present(3));
        assert!(!rate.should_present(4));
    }

    #[derive(Debug, PartialEq, Eq)]
    struct OneSecondOracle {
        state: i32,
        framebuffer: Vec<u8>,
        inputs: Vec<i32>,
        audio: Vec<AudioEvent>,
        presents: usize,
    }

    fn run_one_second_oracle(rate: PresentationRate) -> OneSecondOracle {
        let mut state = 0i32;
        let mut framebuffer = vec![0u8; 16];
        let mut inputs = Vec::new();
        let mut audio = Vec::new();
        let mut presents = 0;
        for tick in 0..SIM_HZ as i32 {
            // A one-tick press followed by release crosses one 30 Hz batch.
            let input = if tick == 10 { 1 << 4 } else { 0 };
            inputs.push(input);
            state = state.wrapping_mul(33).wrapping_add(tick ^ input);
            framebuffer[(tick as usize) & 15] = state as u8;
            if tick == 10 || tick == 11 {
                audio.push(AudioEvent {
                    freq: 440 + tick,
                    dur: 2,
                    vol: 50,
                    flags: tick & 1,
                });
            }
            if rate.should_present(tick + 1) {
                presents += 1;
            }
        }
        OneSecondOracle {
            state,
            framebuffer,
            inputs,
            audio,
            presents,
        }
    }

    #[test]
    fn one_second_state_input_framebuffer_and_audio_ignore_presentation_rate() {
        let at_30 = run_one_second_oracle(PresentationRate::Hz30);
        let at_60 = run_one_second_oracle(PresentationRate::Hz60);
        assert_eq!(at_30.presents, 30);
        assert_eq!(at_60.presents, 60);
        assert_eq!(at_30.state, at_60.state);
        assert_eq!(at_30.framebuffer, at_60.framebuffer);
        assert_eq!(at_30.inputs, at_60.inputs);
        assert_eq!(at_30.audio, at_60.audio);
        assert_eq!(at_30.audio.len(), 2);
    }

    #[test]
    fn presentation_rate_rejects_unsupported_cadence() {
        assert_eq!(PresentationRate::parse(30), Ok(PresentationRate::Hz30));
        assert_eq!(PresentationRate::parse(60), Ok(PresentationRate::Hz60));
        assert!(PresentationRate::parse(120).is_err());
        assert!(PresentationRate::parse(24).is_err());
    }

    #[test]
    fn simulation_pacer_runs_fixed_step() {
        let t0 = Instant::now();
        let mut pacer = SimulationPacer::new(t0);
        let step = Duration::from_nanos(1_000_000_000 / u64::from(SIM_HZ));
        assert_eq!(pacer.due(t0), 1);
        assert_eq!(pacer.due(t0), 0);
        assert_eq!(pacer.due(t0 + step), 1);
        assert_eq!(pacer.due(t0 + step * 3), 2);
    }

    #[test]
    fn simulation_pacer_caps_catchup_and_resyncs() {
        let t0 = Instant::now();
        let mut pacer = SimulationPacer::new(t0);
        assert_eq!(pacer.due(t0 + Duration::from_secs(1)), MAX_CATCHUP);
        assert_eq!(pacer.due(t0 + Duration::from_secs(1)), 0);
    }

    type MicroAiWarOutcome = (usize, u64, Vec<u8>, Vec<AudioEvent>, Vec<String>);

    fn run_micro_ai_war_one_second(rate: PresentationRate) -> Option<MicroAiWarOutcome> {
        let wasm_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../carts/micro-ai-war/cart.wasm");
        let wasm = std::fs::read(wasm_path).ok()?;
        let mut host = Host::new(&wasm, 320, 240).expect("load Micro AI War");
        host.start().expect("start Micro AI War");
        let mut presents = 0;
        let mut audio = Vec::new();
        let mut final_hash = 0;
        let mut final_trace = Vec::new();
        for tick in 0..SIM_HZ {
            let input = match tick {
                0 => 1 << 6, // Start: leave title.
                1 => 0,      // Release so guest-side edges arm normally.
                _ => 1 << 3, // Hold right for the remainder of the second.
            };
            let rec = host.step(input).expect("step Micro AI War");
            audio.extend(rec.audio.iter().cloned());
            final_hash = rec.hash;
            final_trace = rec.trace;
            if rate.should_present(host.frames_run()) {
                presents += 1;
            }
        }
        assert_eq!(host.frames_run(), SIM_HZ as i32);
        Some((
            presents,
            final_hash,
            host.fb().px.clone(),
            audio,
            final_trace,
        ))
    }

    #[test]
    fn micro_ai_war_state_and_audio_ignore_presentation_rate() {
        let Some(at_30) = run_micro_ai_war_one_second(PresentationRate::Hz30) else {
            eprintln!("SKIP: build carts/micro-ai-war/cart.wasm to run cart timing integration");
            return;
        };
        let at_60 = run_micro_ai_war_one_second(PresentationRate::Hz60)
            .expect("Micro AI War wasm existed for the 30 Hz schedule");
        assert_eq!(at_30.0, 30);
        assert_eq!(at_60.0, 60);
        assert_eq!(at_30.1, at_60.1);
        assert_eq!(at_30.2, at_60.2);
        assert_eq!(at_30.3, at_60.3);
        assert_eq!(at_30.4, at_60.4);
    }
}
