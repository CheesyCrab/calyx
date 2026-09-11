// screen — CartBase's position utilities, integer, per-axis (no Vector2
// in AS). All read the live width()/height() so they hold on any profile.

import { width, height } from "./draw";

function clamp(v: i32, lo: i32, hi: i32): i32 {
  return v < lo ? lo : v > hi ? hi : v;
}

// Euclidean modulo — wraps negatives into [0, m).
function wrap(v: i32, m: i32): i32 {
  return ((v % m) + m) % m;
}

export function clamp_x(x: i32, margin: i32 = 0): i32 {
  return clamp(x, margin, width() - margin);
}

export function clamp_y(y: i32, margin: i32 = 0): i32 {
  return clamp(y, margin, height() - margin);
}

export function wrap_x(x: i32): i32 {
  return wrap(x, width());
}

export function wrap_y(y: i32): i32 {
  return wrap(y, height());
}

export function is_on_screen(x: i32, y: i32, margin: i32 = 0): bool {
  return (
    x >= -margin && x <= width() + margin &&
    y >= -margin && y <= height() + margin
  );
}
