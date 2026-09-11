// av-events (v1 conformance cart) — set_palette, blit, tone; authored
// through Sunny (ROADMAP T5).
//
// Pins: a custom palette declared at start() (recorded as verified
// state, "custom:<digest>" in status.json); 1:1 blit with flip-x /
// flip-y / color-key and edge clipping; and the tone event stream —
// audio is verified as events in frames.jsonl, never as samples
// (ABI §4 Audio). events.golden.jsonl beside this cart is the
// expected stream; it is known by construction from the schedule
// below, so it ships before any runtime can run the cart.

import {
  run_start, run_update,
  frame, clear, px_rect,
  blit_sprite, set_palette_bytes, tone, trace,
  FLIP_X, FLIP_Y, COLOR_KEY,
} from "../../../sdk/assembly/index";

const PAL_N: i32 = 32;
let pal = new StaticArray<u8>(96);   // 32 RGB888 triples
let spr = new StaticArray<u8>(64);   // 8x8 sprite, index 0 = hole

let f: i32 = 0;

function cart_ready(): void {
  // deterministic 32-entry ramp — replaces SWEETIE_16 for this cart
  for (let i = 0; i < PAL_N; i++) {
    pal[i * 3] = <u8>(i * 8);
    pal[i * 3 + 1] = <u8>(255 - i * 7);
    pal[i * 3 + 2] = <u8>(32 + i * 5);
  }
  set_palette_bytes(pal, PAL_N);

  // asymmetric pattern (so flips are visible) with index-0 holes
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const hole = (x + y) % 4 == 0;
      spr[y * 8 + x] = hole ? 0 : <u8>(((x + y * 2) % 31) + 1);
    }
  }
}

function cart_process(): void {
  f = frame();

  // tone schedule — must reproduce events.golden.jsonl exactly
  if (f == 10) tone(440, 30, 80, 0);             // square,   ch 0
  if (f == 20) tone(220, 15, 60, 1 | (1 << 2));  // triangle, ch 1
  if (f == 30) tone(880, 8, 100, 2 | (2 << 2));  // sine,     ch 2
  if (f == 40) tone(110, 45, 40, 3 | (3 << 2));  // noise,    ch 3
}

function cart_draw(): void {
  clear(1);
  px_rect(0, 200, 320, 40, 5); // backdrop band so color-key holes show

  // marching blits: plain, flip-x, flip-y, both; color-key over band
  blit_sprite(spr, 8, 8, 20 + f, 30);
  blit_sprite(spr, 8, 8, 20 + f, 50, FLIP_X);
  blit_sprite(spr, 8, 8, 20 + f, 70, FLIP_Y);
  blit_sprite(spr, 8, 8, 20 + f, 90, FLIP_X | FLIP_Y);
  blit_sprite(spr, 8, 8, 40 + f * 2, 210, COLOR_KEY);

  // clipped blits at the right and left edges
  blit_sprite(spr, 8, 8, 316 - (f % 12), 120, FLIP_X | FLIP_Y | COLOR_KEY);
  blit_sprite(spr, 8, 8, -4, 140 + (f % 9), COLOR_KEY);

  trace("f=" + f.toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
