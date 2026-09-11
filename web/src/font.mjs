// The built-in m6x11 text font (ABI §4 Drawing).
//
// Uses the embedded copy of the ABI-pinned artifact (src/m6x11.mjs, generated
// from assets/fonts/m6x11-v1.json — the same file the native core embeds). The
// embed keeps the runtime browser-safe (no node:fs) and self-contained; a
// unit test guards it against drift. Bytes are treated as bytes: glyphs exist
// for 0x20..=0x7E, every other byte renders the placeholder and advances. The
// host never decodes UTF-8.

import M6X11 from "./m6x11.mjs";

export class Font {
  constructor(json = M6X11) {
    this.glyphs = new Map();
    for (const [k, g] of Object.entries(json.glyphs)) {
      this.glyphs.set(Number(k), { advance: g.advance, rows: g.bitmap });
    }
    this.placeholder = { advance: json.placeholder.advance, rows: json.placeholder.bitmap };
    this.lineHeight = json.line_height;
    this.baseline = json.baseline;
  }

  glyph(byte) {
    if (byte >= 0x20 && byte <= 0x7e) {
      return this.glyphs.get(byte) ?? this.placeholder;
    }
    return this.placeholder;
  }
}

// Render `bytes` at (x,y) (cell top-left) in palette color `idx`, at integer
// `scale` (scale<1 → 1). Each source pixel becomes a scale×scale block; the
// cursor advances by advance*scale per glyph. Draws every set bit (bit 0 =
// leftmost), so glyphs wider than `advance` are not clipped.
export function drawText(fb, font, x, y, bytes, idx, scale) {
  scale = scale < 1 ? 1 : scale;
  let cx = x;
  for (const b of bytes) {
    const g = font.glyph(b);
    for (let row = 0; row < g.rows.length; row++) {
      let bits = g.rows[row];
      let col = 0;
      while (bits !== 0) {
        if (bits & 1) {
          const px0 = cx + col * scale;
          const py0 = y + row * scale;
          fb.rect(px0, py0, scale, scale, idx);
        }
        bits >>>= 1;
        col++;
      }
    }
    cx += g.advance * scale;
  }
}
