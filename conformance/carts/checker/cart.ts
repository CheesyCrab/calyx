// checker (v1 conformance cart) — the deterministic gate cart from ABI §6,
// authored through Sunny (ROADMAP T5).
//
// Purely frame-counter + input driven: no wall-clock, no RNG. That is what
// makes its headless dump reproducible and therefore golden-testable.

import {
  run_start, run_update,
  frame, width, height,
  clear, px_rect, px_text, trace,
  right_held,
  BLACK, WHITE, RED,
} from "../../../sdk/assembly/index";

const CELL: i32 = 16;

let f: i32 = 0;
let phase: i32 = 0;

function cart_ready(): void {
  // nothing to seed
}

function cart_process(): void {
  f = frame();
  phase = f / 8;
}

function cart_draw(): void {
  const cols = width() / CELL;
  const rows = height() / CELL;

  clear(BLACK);

  // scrolling checkerboard
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const on = ((cx + cy + phase) & 1) == 1;
      if (on) px_rect(cx * CELL, cy * CELL, CELL, CELL, WHITE);
    }
  }

  // a marker that rides along the top while RIGHT is held — exercises btn()
  if (right_held()) {
    px_rect((f % cols) * CELL, 0, CELL, CELL, RED);
  }

  // a tiny HUD — exercises the text import (real m6x11, scale 1)
  px_text(4, 4, "CALYX", WHITE);
  px_text(4, 16, "F" + f.toString(), WHITE);

  // the cart chooses what lands in frames.jsonl (ABI §4 trace)
  trace("mode=CHECKER");
  trace("scroll=" + phase.toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
