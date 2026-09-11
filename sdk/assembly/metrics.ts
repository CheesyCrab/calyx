// metrics — guest-side text measurement over the ABI advance table
// (§4a: Sunny embeds the advances; no host metrics call).
//
// Measurement mirrors the host's rendering rule byte-for-byte: UTF-8
// bytes, a real advance for 0x20..0x7E, the placeholder advance for
// everything else (the host never decodes UTF-8; ABI §4 Drawing).

import { ADVANCES, PLACEHOLDER_ADVANCE, FONT_LINE_HEIGHT } from "./font";
import { px_text } from "./draw";

function byte_advance(b: i32): i32 {
  return b >= 0x20 && b <= 0x7e
    ? <i32>ADVANCES[b - 0x20]
    : PLACEHOLDER_ADVANCE;
}

// Pixel width of `s` as the host will render it at `scale`.
export function text_width(s: string, scale: i32 = 1): i32 {
  const buf = String.UTF8.encode(s);
  const bytes = Uint8Array.wrap(buf);
  let w = 0;
  for (let i = 0; i < bytes.length; i++) {
    w += byte_advance(bytes[i]);
  }
  return w * (scale < 1 ? 1 : scale);
}

// Line advance for stacked text at `scale`.
export function text_line_height(scale: i32 = 1): i32 {
  return FONT_LINE_HEIGHT * (scale < 1 ? 1 : scale);
}

// CartBase's px_text_centered: centered on x, top at y.
export function px_text_centered(
  x: i32, y: i32, s: string, idx: i32, scale: i32 = 1,
): void {
  px_text(x - text_width(s, scale) / 2, y, s, idx, scale);
}

// Greedy word-wrap into lines no wider than max_w; '\n' forces a break,
// an over-long single word overflows rather than breaking mid-word.
// Draws top-left at (x, y), one text_line_height(scale) per line;
// returns the number of lines drawn.
export function px_text_wrapped(
  x: i32, y: i32, s: string, idx: i32, max_w: i32, scale: i32 = 1,
): i32 {
  const lh = text_line_height(scale);
  let lines = 0;
  const paragraphs = s.split("\n");
  for (let p = 0; p < paragraphs.length; p++) {
    const words = paragraphs[p].split(" ");
    let line = "";
    for (let i = 0; i < words.length; i++) {
      const tryLine = line.length == 0 ? words[i] : line + " " + words[i];
      if (line.length > 0 && text_width(tryLine, scale) > max_w) {
        px_text(x, y + lines * lh, line, idx, scale);
        lines++;
        line = words[i];
      } else {
        line = tryLine;
      }
    }
    px_text(x, y + lines * lh, line, idx, scale);
    lines++;
  }
  return lines;
}
