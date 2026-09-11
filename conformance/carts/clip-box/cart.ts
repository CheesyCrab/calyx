// clip-box (v1 conformance cart) — clipping + input edge cases, authored
// through Sunny (ROADMAP T5).
//
// Pins: silent per-pixel clipping of pixel/rect/hline/vline at and far
// beyond all four edges; zero and negative sizes drawing nothing;
// spans wider/taller than the screen; exact corner pixels. The input
// feed supplies the edge cases (1-frame taps, all-buttons-at-once,
// per-frame toggles, a press on the final frame) and the held mask is
// drawn, so every input quirk lands in the framebuffer hash.

import {
  run_start, run_update,
  frame, btn, clear,
  px_pixel, px_rect, px_hline, px_vline, trace,
  BLACK, WHITE, RED, GREEN, BLUE, YELLOW, CYAN,
} from "../../../sdk/assembly/index";

let f: i32 = 0;
let m: i32 = 0;

function cart_ready(): void {
  // nothing to seed
}

function cart_process(): void {
  f = frame();
  m = btn();
}

function cart_draw(): void {
  clear(BLACK);

  // input visualizer: one cell per held button bit (bits 0..6)
  for (let b = 0; b < 7; b++) {
    if ((m & (1 << b)) != 0) {
      px_rect(8 + b * 12, 8, 8, 8, YELLOW);
    }
  }

  // shapes straddling every edge, modulated by frame AND input mask
  const off = (f * 3 + m) % 40;
  px_rect(-off, 40, 30, 20, RED);             // straddles left
  px_rect(290 + off, 70, 60, 20, GREEN);      // straddles right
  px_rect(100, -off, 20, 30, BLUE);           // straddles top
  px_rect(140, 220 + off, 20, 60, CYAN);      // straddles bottom

  // fully off-screen: must be silently clipped, affect nothing
  px_rect(-5000, -5000, 100, 100, WHITE);
  px_rect(100000, 100000, 100, 100, WHITE);
  px_pixel(-1, -1, WHITE);
  px_pixel(320, 240, WHITE);

  // zero and negative sizes draw nothing
  px_rect(160, 120, 0, 10, WHITE);
  px_rect(160, 120, -10, 10, WHITE);
  px_hline(160, 130, 0, WHITE);
  px_hline(160, 132, -8, WHITE);
  px_vline(170, 130, 0, WHITE);
  px_vline(172, 130, -8, WHITE);

  // spans crossing the whole screen from off-screen origins
  px_hline(-100, 160 + (f % 5), 10000, WHITE);
  px_vline(60 + (f % 7), -100, 10000, WHITE);

  // the four exact corner pixels
  px_pixel(0, 0, RED);
  px_pixel(319, 0, GREEN);
  px_pixel(0, 239, BLUE);
  px_pixel(319, 239, WHITE);

  trace("m=" + m.toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
