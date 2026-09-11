// geometry — the guest-side primitives (ABI §4 placement rule).
//
// px_line / px_circle / outlines are deliberately NOT host imports:
// implemented once here over pixel/hline/vline they are parity-free by
// construction — the same .wasm runs identically on every runtime.
// Integer-only math; the exact pixel shapes below are Sunny's and are
// pinned by the conformance cart that exercises them.

import { px_pixel, px_rect, px_hline, px_vline } from "./draw";

// Bresenham line, all octants.
export function px_line(
  x0: i32, y0: i32, x1: i32, y1: i32, idx: i32,
): void {
  let x = x0;
  let y = y0;
  const dx = x1 > x0 ? x1 - x0 : x0 - x1;
  const dy = y1 > y0 ? y0 - y1 : y1 - y0; // negative magnitude
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    px_pixel(x, y, idx);
    if (x == x1 && y == y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Rectangle outline; width > 1 nests inward like CartBase's stroke.
export function px_rect_outline(
  x: i32, y: i32, w: i32, h: i32, idx: i32, width: i32 = 1,
): void {
  for (let t = 0; t < width; t++) {
    const rw = w - 2 * t;
    const rh = h - 2 * t;
    if (rw <= 0 || rh <= 0) {
      break;
    }
    if (rw <= 2 || rh <= 2) {
      px_rect(x + t, y + t, rw, rh, idx);
      break;
    }
    px_hline(x + t, y + t, rw, idx);
    px_hline(x + t, y + t + rh - 1, rw, idx);
    px_vline(x + t, y + t + 1, rh - 2, idx);
    px_vline(x + t + rw - 1, y + t + 1, rh - 2, idx);
  }
}

function isqrt(v: i32): i32 {
  let r = 0;
  while ((r + 1) * (r + 1) <= v) r++;
  return r;
}

// Filled circle as hline spans: for each row the span is the largest
// dx with dx² + dy² ≤ r².
export function px_circle(cx: i32, cy: i32, r: i32, idx: i32): void {
  if (r < 0) return;
  for (let dy = -r; dy <= r; dy++) {
    const dx = isqrt(r * r - dy * dy);
    px_hline(cx - dx, cy + dy, 2 * dx + 1, idx);
  }
}

// Circle outline via the midpoint algorithm (8-way symmetry);
// width > 1 nests inward ring by ring.
export function px_circle_outline(
  cx: i32, cy: i32, r: i32, idx: i32, width: i32 = 1,
): void {
  for (let t = 0; t < width; t++) {
    const rr = r - t;
    if (rr < 0) break;
    let x = rr;
    let y = 0;
    let err = 1 - rr;
    while (x >= y) {
      px_pixel(cx + x, cy + y, idx);
      px_pixel(cx + y, cy + x, idx);
      px_pixel(cx - y, cy + x, idx);
      px_pixel(cx - x, cy + y, idx);
      px_pixel(cx - x, cy - y, idx);
      px_pixel(cx - y, cy - x, idx);
      px_pixel(cx + y, cy - x, idx);
      px_pixel(cx + x, cy - y, idx);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }
}
