// music — CartBase's audio layer as a Sunny sequencer (ABI §4a): no
// host-side music state, everything lowers to per-frame `tone` calls,
// which the dump verifies as events (ABI §4 Audio).
//
// Integer and frame-stepped by design: one sequencer step per beat,
// ticks-per-step = 3600 / bpm at the fixed 60 Hz simulation step (truncated —
// deliberately frame-quantized, not sample-identical to Godot's
// wall-clock CartAudio). run_update ticks the sequencer between
// cart_process and cart_draw, so within a frame the cart's own
// sfx/tone calls precede sequencer-emitted notes; per step, drum rows
// (kick, snare, hihat) fire before voices 0..2 — the CartAudio order.
//
// Channel map mirrors CartAudio: voices 0-2 melodic, 3 drums + sfx.
// Envelope, sweep, and master volume are presenter-side synthesis
// concerns with no ABI surface; the event stream carries what the
// beeper contract has (freq, dur, vol, waveform|channel flags).

import { tone } from "./draw";

// ── Waveforms (ABI §4 Audio, tone flag bits 0-1) ───────────────────────
export const WAVE_SQUARE: i32 = 0;
export const WAVE_TRIANGLE: i32 = 1;
export const WAVE_SINE: i32 = 2;
export const WAVE_NOISE: i32 = 3;

function flags(wave: i32, channel: i32): i32 {
  return (wave & 3) | ((channel & 3) << 2);
}

// ── Note → integer frequency (12-TET, A4 = 440) ────────────────────────
// Pinned table, octaves 0..8, round(440 * 2^(d/12)) — no float at
// runtime, and no octave-doubling drift from re-deriving rows.
const FREQS: StaticArray<u16> = [
  16, 17, 18, 19, 21, 22, 23, 24, 26, 28, 29, 31,
  33, 35, 37, 39, 41, 44, 46, 49, 52, 55, 58, 62,
  65, 69, 73, 78, 82, 87, 92, 98, 104, 110, 117, 123,
  131, 139, 147, 156, 165, 175, 185, 196, 208, 220, 233, 247,
  262, 277, 294, 311, 330, 349, 370, 392, 415, 440, 466, 494,
  523, 554, 587, 622, 659, 698, 740, 784, 831, 880, 932, 988,
  1047, 1109, 1175, 1245, 1319, 1397, 1480, 1568, 1661, 1760, 1865, 1976,
  2093, 2217, 2349, 2489, 2637, 2794, 2960, 3136, 3322, 3520, 3729, 3951,
  4186, 4435, 4699, 4978, 5274, 5588, 5920, 6272, 6645, 7040, 7459, 7902,
];

const NOTE_NAMES: string[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

// "C4" / "A#3" → Hz; "." or "" (a rest) → 0.
export function note_to_freq(note: string): i32 {
  if (note == "." || note.length == 0) return 0;
  let name = "";
  let i = 0;
  while (i < note.length) {
    const c = note.charAt(i);
    if (c >= "0" && c <= "9") break;
    name += c;
    i++;
  }
  const semitone = NOTE_NAMES.indexOf(name);
  assert(semitone >= 0, "unknown note: " + note);
  const octave = i < note.length ? <i32>parseInt(note.substring(i)) : 4;
  assert(octave >= 0 && octave <= 8, "octave out of range: " + note);
  return <i32>FREQS[octave * 12 + semitone];
}

function wave_from_name(wave_name: string): i32 {
  if (wave_name == "square") return WAVE_SQUARE;
  if (wave_name == "triangle") return WAVE_TRIANGLE;
  if (wave_name == "sine") return WAVE_SINE;
  if (wave_name == "noise") return WAVE_NOISE;
  assert(false, "unknown wave: " + wave_name);
  return WAVE_TRIANGLE;
}

// ── Sequencer state ────────────────────────────────────────────────────
let _bpm: i32 = 120;
let _playing: bool = false;
let _countdown: i32 = 0;

// Drums: rows of 0/1 steps — row 0 kick, 1 snare, 2 hihat (CartAudio).
let _drum_pattern: i32[][] = [];
let _drum_step: i32 = 0;

// Melody: 3 voices of "NOTE[:beats]" entries; "." rests.
let _melodies: string[][] = [[], [], []];
let _melody_idx: StaticArray<i32> = [0, 0, 0];
let _voice_waves: StaticArray<i32> = [
  WAVE_TRIANGLE, WAVE_SINE, WAVE_SQUARE, // CartAudio's defaults
];

function frames_per_step(): i32 {
  const f = 3600 / _bpm; // one beat at the fixed 60 Hz simulation step
  return f < 1 ? 1 : f;
}

// ── The CartBase-shaped face ───────────────────────────────────────────
export function set_drums(bpm: i32, pattern: i32[][]): void {
  _bpm = bpm;
  _drum_pattern = pattern;
  _drum_step = 0;
  _countdown = 0;
}

// Entries: "C4" (one beat), "E4:2" (held two beats), "." (rest).
export function set_melody(voice: i32, notes: string[]): void {
  if (voice < 0 || voice > 2) return;
  _melodies[voice] = notes;
  _melody_idx[voice] = 0;
}

export function set_voice(voice: i32, wave_name: string): void {
  if (voice < 0 || voice > 2) return;
  _voice_waves[voice] = wave_from_name(wave_name);
}

export function set_bpm(bpm: i32): void {
  _bpm = bpm;
}

export function play_music(): void {
  _playing = true;
  _drum_step = 0;
  _countdown = frames_per_step();
  for (let v = 0; v < 3; v++) _melody_idx[v] = 0;
}

// Stops emitting; already-requested tones ring out their dur (the
// event stream has no note-off — releases are presenter synthesis).
export function stop_music(): void {
  _playing = false;
}

// ── Sfx (channel 3) — CartAudio's presets, beeper-projected ────────────
export function sfx(preset: string): void {
  if (preset == "jump") { tone(260, 9, 60, flags(WAVE_SINE, 3)); return; }
  if (preset == "coin") { tone(880, 5, 40, flags(WAVE_SQUARE, 3)); return; }
  if (preset == "explosion") {
    tone(100, 24, 70, flags(WAVE_NOISE, 3));
    return;
  }
  if (preset == "hit") { tone(200, 7, 60, flags(WAVE_NOISE, 3)); return; }
  if (preset == "laser") {
    tone(1200, 9, 40, flags(WAVE_SQUARE, 3));
    return;
  }
  if (preset == "powerup") {
    tone(400, 18, 50, flags(WAVE_SINE, 3));
    return;
  }
  if (preset == "blip") { tone(660, 3, 30, flags(WAVE_SQUARE, 3)); return; }
  if (preset == "fanfare") {
    tone(523, 24, 50, flags(WAVE_TRIANGLE, 3));
    return;
  }
  if (preset == "pickup") {
    tone(600, 7, 50, flags(WAVE_TRIANGLE, 3));
    return;
  }
  if (preset == "death") { tone(300, 30, 50, flags(WAVE_SQUARE, 3)); return; }
  assert(false, "unknown sfx: " + preset);
}

export function sfx_note(
  note: string, dur_frames: i32 = 12, wave_name: string = "triangle",
): void {
  const freq = note_to_freq(note);
  if (freq <= 0) return;
  tone(freq, dur_frames, 60, flags(wave_from_name(wave_name), 3));
}

// ── Per-step triggers (drums first, then voices — CartAudio order) ─────
function trigger_drums(step: i32): void {
  if (_drum_pattern.length == 0) return;
  const num_steps = _drum_pattern[0].length;
  if (num_steps == 0) return;
  const s = step % num_steps;
  for (let row = 0; row < _drum_pattern.length; row++) {
    const row_data = _drum_pattern[row];
    if (s >= row_data.length || row_data[s] != 1) continue;
    if (row == 0) tone(150, 7, 70, flags(WAVE_SINE, 3));        // kick
    else if (row == 1) tone(250, 6, 50, flags(WAVE_NOISE, 3));  // snare
    else if (row == 2) tone(800, 3, 30, flags(WAVE_NOISE, 3));  // hihat
  }
}

function trigger_melody_step(): void {
  const fps = frames_per_step();
  for (let v = 0; v < 3; v++) {
    const notes = _melodies[v];
    if (notes.length == 0) continue;
    let idx = _melody_idx[v];
    if (idx >= notes.length) idx = 0;
    const entry = notes[idx];
    let name = entry;
    let beats = 1;
    const colon = entry.indexOf(":");
    if (colon >= 0) {
      name = entry.substring(0, colon);
      beats = <i32>parseInt(entry.substring(colon + 1));
      if (beats < 1) beats = 1;
    }
    const freq = note_to_freq(name);
    if (freq > 0) {
      // CartAudio holds a note 0.9 of its beats, then releases
      const dur = (beats * fps * 9) / 10;
      tone(freq, dur < 1 ? 1 : dur, 50, flags(_voice_waves[v], v));
    }
    _melody_idx[v] = idx + 1;
  }
}

// Called once per simulation tick by run_update (lifecycle.ts). The first step
// fires one full beat after play_music(), like CartAudio's timer.
export function music_tick(): void {
  if (!_playing) return;
  _countdown--;
  if (_countdown > 0) return;
  trigger_drums(_drum_step);
  trigger_melody_step();
  _drum_step++;
  _countdown = frames_per_step();
}
