// music-box (v1 conformance cart) — the Sunny-surface stressor
// (ROADMAP T5).
//
// Everything here is GUEST-side Sunny code lowering to already-pinned
// host imports, so this golden pins the SDK's semantics, not new ABI
// surface: the frame-stepped sequencer (drums + two voices + set_voice,
// play_music/stop_music) emitting the tone event stream; sfx presets and
// sfx_note from input edges; the guest-side geometry (px_line,
// px_circle, outlines); text metrics (px_text_centered, px_text_wrapped
// over the embedded advance table); and the screen utilities
// (clamp/wrap/is_on_screen). The feed taps A and B for sfx and presses
// START near the end so stop_music's silence is part of the golden.

import {
  run_start, run_update,
  frame, clear, trace,
  px_pixel, px_rect,
  px_line, px_circle, px_circle_outline, px_rect_outline,
  px_text_centered, px_text_wrapped,
  clamp_x, clamp_y, wrap_x, is_on_screen,
  a_pressed, b_pressed, start_pressed,
  set_drums, set_melody, set_voice, play_music, stop_music,
  sfx, sfx_note,
  BLACK, WHITE, RED, GREEN, ORANGE, CYAN, PURPLE, LIGHT_GRAY, DARK_GRAY,
} from "../../../sdk/assembly/index";

let f: i32 = 0;

function cart_ready(): void {
  set_voice(0, "square");
  set_voice(1, "triangle");
  set_melody(0, ["C4", "E4", "G4", "C5:2", ".", "G4:2", "."]);
  set_melody(1, ["C3:4", "G3:4"]);
  set_drums(150, [
    [1, 0, 0, 0, 1, 0, 1, 0], // kick
    [0, 0, 1, 0, 0, 0, 1, 0], // snare
    [1, 1, 1, 1, 1, 1, 1, 1], // hihat
  ]);
  play_music();
}

function cart_process(): void {
  f = frame();
  if (a_pressed()) sfx("coin");
  if (b_pressed()) sfx_note("A4", 6, "sine");
  if (start_pressed()) stop_music();
}

function cart_draw(): void {
  clear(BLACK);

  // stage frame — px_rect_outline with a 2px stroke
  px_rect_outline(10, 30, 300, 180, DARK_GRAY, 2);

  // marching lines (Bresenham, all octants over the run)
  px_line(160, 120, 40 + (f * 7) % 240, 40 + (f * 11) % 160, CYAN);
  px_line(20, 220, 300, 40 - (f % 30), PURPLE);

  // filled circle riding wrap_x; outlined circle breathing with the frame
  px_circle(wrap_x(80 + f * 2), 120, 12, ORANGE);
  px_circle_outline(240, 120, 20 + (f % 16), GREEN, 2);

  // clamp keeps the marker pinned to the stage margins
  px_rect(clamp_x(f * 4 - 60, 8), clamp_y(300 - f, 8), 4, 4, RED);

  // a dot that only exists while its path is on screen
  if (is_on_screen(f * 3 - 40, 100)) px_pixel(f * 3 - 40, 100, WHITE);

  // metrics: centered title + wrapped caption off the advance table
  px_text_centered(160, 6, "MUSIC BOX", WHITE, 2);
  px_text_wrapped(16, 40,
    "Sunny plays a tiny loop while lines and circles march in time.",
    LIGHT_GRAY, 120);

  trace("f=" + f.toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
