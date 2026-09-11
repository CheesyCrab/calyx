// input — btn() decode + guest-side edge detection (ABI §4a).
//
// The host gives held level only; Sunny caches last frame's mask so
// *_pressed / *_released work like CartBase's. `run_update` (lifecycle.ts)
// arms the cache automatically; carts writing a raw update() call
// begin_frame()/end_frame() themselves.

import { _btn } from "./abi";

// ── Button bits (ABI §4 Input) ─────────────────────────────────────────
export const BIT_UP: i32 = 0;
export const BIT_DOWN: i32 = 1;
export const BIT_LEFT: i32 = 2;
export const BIT_RIGHT: i32 = 3;
export const BIT_A: i32 = 4;
export const BIT_B: i32 = 5;
export const BIT_START: i32 = 6;
export const BIT_X: i32 = 7;
export const BIT_Y: i32 = 8;
export const BIT_L: i32 = 9;
export const BIT_R: i32 = 10;

let _prev: i32 = 0;
let _cur: i32 = 0;

export function btn(): i32 { return _btn(); }

// Call once at the top of update() before reading input.
export function begin_frame(): void { _cur = _btn(); }
// Call once at the end of update() to arm next frame's edges.
export function end_frame(): void { _prev = _cur; }

function held(bit: i32): bool {
  return (_cur & (1 << bit)) != 0;
}
function pressed(bit: i32): bool {
  return ((_cur & (1 << bit)) != 0) && ((_prev & (1 << bit)) == 0);
}
function released(bit: i32): bool {
  return ((_cur & (1 << bit)) == 0) && ((_prev & (1 << bit)) != 0);
}

export function up_held(): bool { return held(BIT_UP); }
export function down_held(): bool { return held(BIT_DOWN); }
export function left_held(): bool { return held(BIT_LEFT); }
export function right_held(): bool { return held(BIT_RIGHT); }
export function a_held(): bool { return held(BIT_A); }
export function b_held(): bool { return held(BIT_B); }
export function start_held(): bool { return held(BIT_START); }
export function x_held(): bool { return held(BIT_X); }
export function y_held(): bool { return held(BIT_Y); }
export function l_held(): bool { return held(BIT_L); }
export function r_held(): bool { return held(BIT_R); }

export function up_pressed(): bool { return pressed(BIT_UP); }
export function down_pressed(): bool { return pressed(BIT_DOWN); }
export function left_pressed(): bool { return pressed(BIT_LEFT); }
export function right_pressed(): bool { return pressed(BIT_RIGHT); }
export function a_pressed(): bool { return pressed(BIT_A); }
export function b_pressed(): bool { return pressed(BIT_B); }
export function start_pressed(): bool { return pressed(BIT_START); }
export function x_pressed(): bool { return pressed(BIT_X); }
export function y_pressed(): bool { return pressed(BIT_Y); }
export function l_pressed(): bool { return pressed(BIT_L); }
export function r_pressed(): bool { return pressed(BIT_R); }

export function up_released(): bool { return released(BIT_UP); }
export function down_released(): bool { return released(BIT_DOWN); }
export function left_released(): bool { return released(BIT_LEFT); }
export function right_released(): bool { return released(BIT_RIGHT); }
export function a_released(): bool { return released(BIT_A); }
export function b_released(): bool { return released(BIT_B); }
export function start_released(): bool { return released(BIT_START); }
export function x_released(): bool { return released(BIT_X); }
export function y_released(): bool { return released(BIT_Y); }
export function l_released(): bool { return released(BIT_L); }
export function r_released(): bool { return released(BIT_R); }

// CartBase's input_vector(), split into components (no Vector2 in AS):
// -1 / 0 / +1 per axis, y grows down like the framebuffer.
export function input_x(): i32 {
  let x = 0;
  if (held(BIT_LEFT)) x -= 1;
  if (held(BIT_RIGHT)) x += 1;
  return x;
}

export function input_y(): i32 {
  let y = 0;
  if (held(BIT_UP)) y -= 1;
  if (held(BIT_DOWN)) y += 1;
  return y;
}
