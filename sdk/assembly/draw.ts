// draw — the CartBase-shaped drawing wrappers over the raw ABI (§4a).
//
// Everything here is a thin marshalling layer; guest-side geometry
// (px_line, px_circle, outlines) lives in geometry.ts per the §4
// placement rule.

import {
  _frame, _width, _height, _cls, _pixel, _rect, _hline, _vline,
  _text, _blit, _set_palette, _tone, _trace,
  _set_color_mode, _rgba_cls, _rgba_rect, _rgba_text, _clip, _clip_reset, _blit_region,
} from "./abi";

// ── blit flag bits (ABI §4 Drawing) ────────────────────────────────────
export const FLIP_X: i32 = 1;
export const FLIP_Y: i32 = 2;
export const COLOR_KEY: i32 = 4;

// ── Device / frame ─────────────────────────────────────────────────────
export function frame(): i32 { return _frame(); }
export function width(): i32 { return _width(); }
export function height(): i32 { return _height(); }

// ── Drawing ────────────────────────────────────────────────────────────
export function clear(idx: i32 = 0): void { _cls(idx); }

export function px_pixel(x: i32, y: i32, idx: i32): void {
  _pixel(x, y, idx);
}

export function px_rect(x: i32, y: i32, w: i32, h: i32, idx: i32): void {
  _rect(x, y, w, h, idx);
}

export function px_hline(x: i32, y: i32, w: i32, idx: i32): void {
  _hline(x, y, w, idx);
}

export function px_vline(x: i32, y: i32, h: i32, idx: i32): void {
  _vline(x, y, h, idx);
}

export function px_text(
  x: i32, y: i32, s: string, idx: i32, scale: i32 = 1,
): void {
  const buf = String.UTF8.encode(s);
  _text(x, y, changetype<i32>(buf), buf.byteLength, idx, scale);
}

// 1:1 blit of an 8bpp indexed sprite (ABI §4 Drawing).
export function blit_sprite(
  src: StaticArray<u8>, sw: i32, sh: i32, x: i32, y: i32, flags: i32 = 0,
): void {
  _blit(changetype<i32>(src), sw, sh, x, y, sw, sh, flags);
}

// start()-only (ABI §4 Palette): `count` packed RGB888 triples.
export function set_palette_bytes(rgb: StaticArray<u8>, count: i32): void {
  _set_palette(changetype<i32>(rgb), count);
}

// ── Audio (verified as events; ABI §4 Audio) ───────────────────────────
export function tone(freq: i32, dur: i32, vol: i32, flags: i32 = 0): void {
  _tone(freq, dur, vol, flags);
}

// ── Cart-chosen logging ────────────────────────────────────────────────
export function trace(s: string): void {
  const buf = String.UTF8.encode(s);
  _trace(changetype<i32>(buf), buf.byteLength);
}

// Channel arguments use their low byte. Packed color is 0xRRGGBBAA,
// independent of WASM memory byte order; sprite sources are R,G,B,A bytes.
export function rgba(r: i32, g: i32, b: i32, a: i32 = 255): i32 {
  return ((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255);
}
export function use_true_color(): void { _set_color_mode(1); }
export function clear_rgba(color: i32): void { _rgba_cls(color); }
export function rgba_pixel(x: i32, y: i32, color: i32): void { _rgba_rect(x, y, 1, 1, color); }
export function rgba_rect(x: i32, y: i32, w: i32, h: i32, color: i32): void { _rgba_rect(x, y, w, h, color); }
export function rgba_text(x: i32, y: i32, s: string, color: i32, scale: i32 = 1): void {
  const buf = String.UTF8.encode(s);
  _rgba_text(x, y, changetype<i32>(buf), buf.byteLength, color, scale);
}
// Persistent scissor, no stack. Clear ignores it; reset explicitly after a panel.
export function clip_rect(x: i32, y: i32, w: i32, h: i32): void { _clip(x, y, w, h); }
export function reset_clip(): void { _clip_reset(); }
export function blit_sprite_scaled(
  src: StaticArray<u8>, sw: i32, sh: i32, x: i32, y: i32, dw: i32, dh: i32, flags: i32 = 0,
): void { _blit(changetype<i32>(src), sw, sh, x, y, dw, dh, flags); }
export function blit_sprite_region(
  src: StaticArray<u8>, sw: i32, sh: i32, sx: i32, sy: i32, rw: i32, rh: i32,
  x: i32, y: i32, dw: i32, dh: i32, flags: i32 = 0, tint: i32 = 0xffffff, opacity: i32 = 255,
): void {
  _blit_region(changetype<i32>(src), sw, sh, sx, sy, rw, rh, x, y, dw, dh, flags, tint, opacity);
}
export function blit_rgba(
  src: StaticArray<u8>, sw: i32, sh: i32, x: i32, y: i32,
  flags: i32 = 0, tint: i32 = 0xffffff, opacity: i32 = 255,
): void { blit_rgba_region(src, sw, sh, 0, 0, sw, sh, x, y, sw, sh, flags, tint, opacity); }
export function blit_rgba_region(
  src: StaticArray<u8>, sw: i32, sh: i32, sx: i32, sy: i32, rw: i32, rh: i32,
  x: i32, y: i32, dw: i32, dh: i32, flags: i32 = 0, tint: i32 = 0xffffff, opacity: i32 = 255,
): void {
  _blit_region(changetype<i32>(src), sw, sh, sx, sy, rw, rh, x, y, dw, dh, flags | 8, tint, opacity);
}
