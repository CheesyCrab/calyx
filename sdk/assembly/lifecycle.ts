// lifecycle — the CartBase-shaped frame skeleton (ABI §4a).
//
// A Sunny cart defines cart_ready / cart_process / cart_draw and wires
// the two ABI exports with a 3-line shim:
//
//   export function start(): void { run_start(cart_ready); }
//   export function update(): void { run_update(cart_process, cart_draw); }
//
// run_update owns the frame bracket — input edge-arming (input.ts) and,
// once a cart uses the sequencer, the per-frame music tick — so authors
// can't forget them. Carts that want a raw update() can still call
// begin_frame()/end_frame() themselves.

import { begin_frame, end_frame } from "./input";
import { music_tick } from "./music";
import { frame } from "./draw";

export function run_start(ready: () => void): void {
  ready();
}

export function run_update(process: () => void, draw: () => void): void {
  begin_frame();
  process();
  music_tick();
  draw();
  end_frame();
}

/// Run deterministic gameplay at 60 Hz while drawing even-numbered cart
/// frames only. Pair this with `presentation = 30` in cart.toml so presenters
/// show exactly the frames that were redrawn.
export function run_update_30(process: () => void, draw: () => void): void {
  begin_frame();
  process();
  music_tick();
  if ((frame() & 1) == 0) draw();
  end_frame();
}
