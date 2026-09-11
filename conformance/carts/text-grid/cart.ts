// text-grid (v1 conformance cart) — the text stressor, authored through
// Sunny (ROADMAP T5).
//
// Pins: the full m6x11 printable range (glyphs AND advance widths —
// each row's layout depends on every advance before it), integer
// scale 1/2/3, scale<1 → 1, per-pixel clipping off all four edges,
// the placeholder rule for non-glyph bytes (control, DEL, and the
// raw bytes of a multi-byte UTF-8 sequence), and empty-string no-op.
// Animated by frame() so the golden cannot be vacuous.

import {
  run_start, run_update,
  frame, clear, px_text, trace,
  BLACK, WHITE, YELLOW, CYAN, RED, LIGHT_GREEN,
} from "../../../sdk/assembly/index";

let f: i32 = 0;

function cart_ready(): void {
  // nothing to seed
}

function cart_process(): void {
  f = frame();
}

function cart_draw(): void {
  clear(BLACK);

  // every printable glyph 0x20..0x7E, 16 per row, scale 1
  let code = 0x20;
  let row = 0;
  while (code <= 0x7e) {
    let s = "";
    for (let i = 0; i < 16 && code <= 0x7e; i++, code++) {
      s += String.fromCharCode(code);
    }
    px_text(4, 4 + row * 12, s, WHITE);
    row++;
  }

  // integer scales (and scale<1 treated as 1)
  px_text(4, 84, "SCALE2", YELLOW, 2);
  px_text(4, 110, "SCALE3", CYAN, 3);
  px_text(120, 84, "SCALE0->1", LIGHT_GREEN, 0);

  // off-edge clipping, marching with the frame counter
  px_text(-30 + f, -5, "TOPLEFT", RED, 2);
  px_text(290 + f, 60, "RIGHTEDGE", RED, 1);
  px_text(150 - f * 2, 233, "BOTTOM", RED, 2);

  // non-glyph bytes render the placeholder and advance normally:
  // BEL (0x07), DEL (0x7F), and "é" = UTF-8 bytes 0xC3 0xA9.
  px_text(4, 150, "A" + String.fromCharCode(0x07) + "B"
    + String.fromCharCode(0x7f) + "CéD", WHITE);

  // empty string draws nothing
  px_text(160, 150, "", WHITE);

  trace("f=" + f.toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
