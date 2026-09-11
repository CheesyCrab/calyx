// Calyx HD Boot — the already-visible 4:3 Classic field widens directly into
// the HD field. Fine rails, small lights, and high-resolution petal contours
// make the extra screen space visible instead of simulating a low-res zoom.

import {
  run_start, run_update, frame, width, height,
  clear, px_rect, px_hline, px_vline,
  px_text_centered, set_palette_bytes, tone, trace,
  BLACK, WHITE, DARK_BLUE, RED, ORANGE, YELLOW, LIGHT_GREEN,
  NAVY, LIGHT_BLUE, CYAN, LIGHT_GRAY, DARK_GRAY,
} from "../../../sdk/assembly/index";
import { launch } from "../../../sdk/assembly/sys";

const LAUNCH_FRAME: i32 = 74;

const CALYX_HD_PALETTE: StaticArray<u8> = [
  0x00, 0x00, 0x00,  0xf4, 0xf1, 0xde,  0x1a, 0x1c, 0x2c,  0x3b, 0x1f, 0x4d,
  0xb1, 0x3e, 0x53,  0xef, 0x7d, 0x57,  0xd6, 0xa6, 0x2a,  0xa7, 0xf0, 0x70,
  0x38, 0xb7, 0x64,  0x25, 0x71, 0x79,  0x29, 0x36, 0x6f,  0x3b, 0x5d, 0xc9,
  0x41, 0xa6, 0xf6,  0x73, 0xef, 0xf7,  0x94, 0xb0, 0xc2,  0x56, 0x6c, 0x86,
];

let f: i32 = 0;
let handed_off: bool = false;

function clamp(v: i32, lo: i32, hi: i32): i32 {
  return v < lo ? lo : v > hi ? hi : v;
}

function ease(frame0: i32, duration: i32): i32 {
  const t = clamp((f - frame0) * 1024 / duration, 0, 1024);
  return t * t / 1024 * (3072 - 2 * t) / 1024;
}

function cart_ready(): void {
  set_palette_bytes(CALYX_HD_PALETTE, 16);
  trace("hd-boot widen " + width().toString() + "x" + height().toString());
}

function cart_process(): void {
  f = frame();
  if (f == 4) tone(220, 6, 28, 1);
  if (f == 20) tone(440, 6, 34, 4);
  if (f == 34) tone(720, 8, 42, 9);
  if (f == 50) tone(1080, 10, 46, 5);
  if (!handed_off && f == LAUNCH_FRAME) {
    handed_off = true;
    launch(0);
  }
}

function fine_diamond(cx: i32, cy: i32, rx: i32, ry: i32, color: i32): void {
  const bands: i32 = 24;
  const bh = ry / bands;
  for (let i: i32 = 0; i < bands; i++) {
    const half = rx * (i + 1) / bands;
    px_rect(cx - half, cy - ry + i * bh, half * 2 + 1, bh + 1, color);
    px_rect(cx - half, cy + ry - (i + 1) * bh, half * 2 + 1, bh + 1, color);
  }
}

function petal(cx: i32, cy: i32, rx: i32, ry: i32, color: i32): void {
  fine_diamond(cx, cy, rx + 5, ry + 5, DARK_BLUE);
  fine_diamond(cx, cy, rx, ry, color);
  if (rx > ry) {
    px_hline(cx - rx + 24, cy - 2, rx * 2 - 48, BLACK);
    px_hline(cx - rx + 42, cy + 3, rx * 2 - 84, WHITE);
  } else {
    px_vline(cx - 2, cy - ry + 24, ry * 2 - 48, BLACK);
    px_vline(cx + 3, cy - ry + 42, ry * 2 - 84, WHITE);
  }
}

function draw_field(field_x: i32, field_w: i32): void {
  px_rect(field_x, 0, field_w, height(), BLACK);
  px_hline(field_x, 52, field_w, CYAN);
  px_hline(field_x, 59, field_w, NAVY);
  px_hline(field_x, height() - 60, field_w, DARK_BLUE);
  px_hline(field_x, height() - 53, field_w, YELLOW);

  const detail = ease(8, 20);
  const rail = field_w * detail / 1024;
  px_hline(field_x, 132, rail, DARK_BLUE);
  px_hline(field_x + field_w - rail, height() - 133, rail, DARK_BLUE);

  for (let i: i32 = 0; i < 54; i++) {
    const x = field_x + (31 + i * 227) % field_w;
    const y = 82 + (17 + i * 97) % (height() - 164);
    const lit = ((f / 3 + i * 2) % 11) == 0;
    px_rect(x, y, lit ? 3 : 1, lit ? 3 : 1, lit ? LIGHT_BLUE : NAVY);
  }
}

function cart_draw(): void {
  clear(DARK_BLUE);
  if (f >= 72) {
    clear(BLACK);
    return;
  }

  // Classic already occupies a 960x720 onscreen rectangle. Only width changes.
  const widen = ease(2, 28);
  const field_w = 960 + 320 * widen / 1024;
  const field_x = (width() - field_w) / 2;
  draw_field(field_x, field_w);

  if (field_x > 0) {
    px_vline(field_x, 0, height(), LIGHT_GRAY);
    px_vline(width() - field_x - 1, 0, height(), LIGHT_GRAY);
    px_vline(field_x - 7, 52, height() - 104, NAVY);
    px_vline(width() - field_x + 6, 52, height() - 104, NAVY);
  }

  const cx = width() / 2;
  const cy = height() / 2;
  const settle = ease(10, 24);
  const left_x = field_x + (cx - 270 - field_x) * settle / 1024;
  const right_x = field_x + field_w + (cx + 270 - field_x - field_w) * settle / 1024;
  const top_y = 52 + (cy - 168 - 52) * settle / 1024;
  const bottom_y = height() - 53 + (cy + 168 - height() + 53) * settle / 1024;

  petal(left_x, cy, 176, 72, f >= 30 ? RED : DARK_GRAY);
  petal(right_x, cy, 176, 72, f >= 30 ? LIGHT_GREEN : DARK_GRAY);
  petal(cx, top_y, 72, 132, f >= 30 ? CYAN : DARK_GRAY);
  petal(cx, bottom_y, 72, 132, f >= 30 ? YELLOW : DARK_GRAY);

  if (f >= 32 && f < 60) {
    px_rect(cx - 205, cy - 56, 411, 113, DARK_BLUE);
    px_hline(cx - 205, cy - 56, 411, LIGHT_BLUE);
    px_hline(cx - 205, cy + 56, 411, ORANGE);
    px_text_centered(cx, cy - 30, "CAL/X  HD", WHITE, 6);
  }

  // A fast left-to-right scan clears the ceremony; it does not zoom again.
  if (f >= 60) {
    const sweep = width() * ease(60, 12) / 1024;
    px_rect(0, 0, sweep, height(), BLACK);
    if (sweep < width()) {
      px_vline(sweep, 0, height(), WHITE);
      px_vline(sweep + 3, 0, height(), CYAN);
    }
  }
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
