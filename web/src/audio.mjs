// Audible `tone` presenter (ROADMAP T13).
//
// The runtime's frame-stamped audio events remain the verified artifact.
// This module is an unverified browser sink, peer to the canvas presenter:
// four Web Audio voices, frame-duration scheduling, and no cart-visible
// state. It is DOM-free and safe to import under Node tests.

const MIX_GAIN = 0.20;
const WAVE_NAMES = ["square", "triangle", "sine", "noise"];

export function decodeTone(event, fps = 60) {
  return {
    frequency: Math.max(0, event.freq | 0),
    duration: Math.max(0, event.dur | 0) / Math.max(1, fps),
    volume: Math.max(0, Math.min(100, event.vol | 0)) / 100,
    wave: event.flags & 3,
    channel: (event.flags >> 2) & 3,
  };
}

export function scheduledTime(anchor, frame, fps, now) {
  return Math.max(now, anchor + frame / Math.max(1, fps));
}

export class TonePresenter {
  constructor({ fps = 60, enabled = true } = {}) {
    this.fps = Math.max(1, fps);
    this.enabled = enabled;
    this.muted = !enabled;
    this.context = null;
    this.anchor = null;
    this.voices = [null, null, null, null];
    this.pending = null;
  }

  get state() {
    if (!this.enabled || this.muted) return "off";
    if (!this.context || this.context.state !== "running") return "enable";
    return "on";
  }

  async unlock() {
    if (!this.enabled || this.muted) return false;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state !== "running") await this.context.resume();
    if (this.context.state === "running" && this.pending) {
      const pending = this.pending;
      this.pending = null;
      this.frame(pending.frame, pending.events);
    }
    return this.context.state === "running";
  }

  async setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) {
      this.reset();
      return false;
    }
    return this.unlock();
  }

  frame(frame, events) {
    const ctx = this.context;
    if (this.muted || !ctx) return;
    if (ctx.state !== "running") {
      // Preserve the gesture-triggered button sound while resume() is in
      // flight, but never accumulate a stale pre-gesture soundtrack.
      if (events.length) this.pending = { frame, events: events.slice() };
      else if (this.pending && frame - this.pending.frame > 4) this.pending = null;
      return;
    }
    if (this.anchor === null) this.anchor = ctx.currentTime - frame / this.fps;
    const when = scheduledTime(this.anchor, frame, this.fps, ctx.currentTime);
    for (const event of events) this.#tone(ctx, when, decodeTone(event, this.fps));
  }

  reset() {
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      if (voice) {
        try { voice.stop(); } catch (_) { /* already stopped */ }
        this.voices[i] = null;
      }
    }
    this.anchor = null;
    this.pending = null;
  }

  #tone(ctx, when, tone) {
    const old = this.voices[tone.channel];
    if (old) {
      try { old.stop(when); } catch (_) { /* already stopped */ }
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(tone.volume * MIX_GAIN, when);
    gain.connect(ctx.destination);

    const stopAt = when + tone.duration;
    let source;
    if (tone.wave === 3) {
      source = this.#noise(ctx, tone, gain);
    } else {
      source = ctx.createOscillator();
      source.type = WAVE_NAMES[tone.wave];
      source.frequency.setValueAtTime(tone.frequency, when);
      source.connect(gain);
    }
    this.voices[tone.channel] = source;
    source.onended = () => {
      gain.disconnect();
      if (this.voices[tone.channel] === source) this.voices[tone.channel] = null;
    };
    source.start(when);
    source.stop(stopAt);
  }

  #noise(ctx, tone, gain) {
    const count = Math.max(1, Math.ceil(tone.duration * ctx.sampleRate));
    const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = (0x6d2b79f5 ^ Math.imul(tone.channel, 0x9e3779b9)) >>> 0;
    let phase = 0;
    let value = 0;
    const step = tone.frequency / ctx.sampleRate;
    for (let i = 0; i < count; i++) {
      if (i === 0 || phase + step >= 1) {
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >>> 17; seed >>>= 0;
        seed ^= seed << 5; seed >>>= 0;
        value = seed & 1 ? 1 : -1;
      }
      data[i] = value;
      phase = (phase + step) % 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    return source;
  }
}
