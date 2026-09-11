//! The built-in `m6x11` text font (ABI §4 Drawing).
//!
//! The host owns the font; carts never upload one. The canonical artifact
//! is the ABI-pinned `assets/fonts/m6x11-v1.json` (glyph bitmaps + advances +
//! the placeholder), embedded here at compile time and parsed once. Bytes
//! are treated as bytes — the host never decodes UTF-8: glyphs exist for
//! `0x20..=0x7E`, every other byte renders the placeholder and advances.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::framebuffer::Framebuffer;

/// One glyph: a per-row bitmap (top to bottom) where bit 0 (LSB) is the
/// leftmost pixel, plus the horizontal advance.
pub struct Glyph {
    pub advance: i32,
    pub rows: Vec<u32>,
}

pub struct Font {
    glyphs: HashMap<u32, Glyph>,
    placeholder: Glyph,
    pub line_height: i32,
    pub baseline: i32,
}

const FONT_JSON: &str = include_str!("../../../assets/fonts/m6x11-v1.json");
static FONT: OnceLock<Font> = OnceLock::new();

/// The pinned `m6x11` font, parsed once.
pub fn m6x11() -> &'static Font {
    FONT.get_or_init(|| Font::parse(FONT_JSON))
}

impl Font {
    fn parse(s: &str) -> Font {
        let v: serde_json::Value =
            serde_json::from_str(s).expect("embedded m6x11-v1.json is valid JSON");
        let glyph_of = |g: &serde_json::Value| Glyph {
            advance: g["advance"].as_i64().expect("glyph advance") as i32,
            rows: g["bitmap"]
                .as_array()
                .expect("glyph bitmap")
                .iter()
                .map(|r| r.as_u64().expect("bitmap row") as u32)
                .collect(),
        };
        let mut glyphs = HashMap::new();
        for (k, val) in v["glyphs"].as_object().expect("glyphs object") {
            let cp = k.parse::<u32>().expect("glyph key is a codepoint");
            glyphs.insert(cp, glyph_of(val));
        }
        Font {
            glyphs,
            placeholder: glyph_of(&v["placeholder"]),
            line_height: v["line_height"].as_i64().expect("line_height") as i32,
            baseline: v["baseline"].as_i64().expect("baseline") as i32,
        }
    }

    /// The glyph for a raw byte: a real glyph for printable ASCII, the
    /// placeholder for everything else (ABI §4 Drawing — no UTF-8 decode).
    fn glyph(&self, byte: u8) -> &Glyph {
        if (0x20..=0x7e).contains(&byte) {
            self.glyphs.get(&(byte as u32)).unwrap_or(&self.placeholder)
        } else {
            &self.placeholder
        }
    }
}

/// Render `bytes` at `(x, y)` (cell top-left) in palette color `idx`, at
/// integer `scale` (`scale < 1` is treated as 1). Each source pixel becomes
/// a `scale × scale` block; the cursor advances by `advance × scale` per
/// glyph. Clips per-pixel like every other draw op (ABI §4 Drawing).
pub fn draw_text(
    fb: &mut Framebuffer,
    font: &Font,
    x: i32,
    y: i32,
    bytes: &[u8],
    idx: u8,
    scale: i32,
) {
    draw_text_impl(fb, font, x, y, bytes, scale, |fb, x, y, w, h| {
        fb.rect(x, y, w, h, idx)
    });
}

#[allow(clippy::too_many_arguments)]
pub fn draw_rgba_text(
    fb: &mut Framebuffer,
    font: &Font,
    x: i32,
    y: i32,
    bytes: &[u8],
    rgba: u32,
    scale: i32,
) {
    draw_text_impl(fb, font, x, y, bytes, scale, |fb, x, y, w, h| {
        fb.rgba_rect(x, y, w, h, rgba)
    });
}
fn draw_text_impl(
    fb: &mut Framebuffer,
    font: &Font,
    x: i32,
    y: i32,
    bytes: &[u8],
    scale: i32,
    mut draw: impl FnMut(&mut Framebuffer, i32, i32, i32, i32),
) {
    let scale = i64::from(scale.max(1));
    let mut cx = i64::from(x);
    for &b in bytes {
        let g = font.glyph(b);
        for (row, &bits) in g.rows.iter().enumerate() {
            for col in 0..32 {
                if bits & (1 << col) != 0 {
                    let x0 = cx + col * scale;
                    let y0 = i64::from(y) + row as i64 * scale;
                    let x1 = (x0 + scale).clamp(0, i64::from(fb.w.max(0)));
                    let y1 = (y0 + scale).clamp(0, i64::from(fb.h.max(0)));
                    let x0 = x0.clamp(0, i64::from(fb.w.max(0)));
                    let y0 = y0.clamp(0, i64::from(fb.h.max(0)));
                    if x0 < x1 && y0 < y1 {
                        draw(fb, x0 as i32, y0 as i32, (x1 - x0) as i32, (y1 - y0) as i32);
                    }
                }
            }
        }
        cx = cx.saturating_add(i64::from(g.advance) * scale);
        if cx >= i64::from(fb.w) {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_full_printable_ascii() {
        let f = m6x11();
        for b in 0x20u8..=0x7e {
            assert!(f.glyphs.contains_key(&(b as u32)), "missing glyph {b:#x}");
        }
        assert_eq!(f.line_height, 14);
        assert_eq!(f.baseline, 11);
    }

    #[test]
    fn non_printable_bytes_use_placeholder() {
        let f = m6x11();
        // control byte and a high byte both fall back to the placeholder
        assert_eq!(f.glyph(0x01).advance, f.placeholder.advance);
        assert_eq!(f.glyph(0xff).rows, f.placeholder.rows);
    }

    #[test]
    fn draw_advances_and_scales() {
        let f = m6x11();
        let adv = f.glyph(b'A').advance;
        let mut fb = Framebuffer::new(64, 32);
        draw_text(&mut fb, f, 0, 0, b"A", 1, 1);
        let drawn = fb.px.iter().filter(|&&p| p == 1).count();
        assert!(drawn > 0, "glyph drew no pixels");

        // scale 2 covers ~4x the pixels of scale 1 for the same glyph
        let mut fb2 = Framebuffer::new(64, 32);
        draw_text(&mut fb2, f, 0, 0, b"A", 1, 2);
        let drawn2 = fb2.px.iter().filter(|&&p| p == 1).count();
        assert_eq!(drawn2, drawn * 4);

        // a two-glyph string is wider than one advance
        let mut fb3 = Framebuffer::new(64, 32);
        draw_text(&mut fb3, f, 0, 0, b"AA", 1, 1);
        let max_x = (0..fb3.w)
            .filter(|&xx| (0..fb3.h).any(|yy| fb3.px[(yy * fb3.w + xx) as usize] == 1))
            .max()
            .unwrap();
        assert!(max_x >= adv, "second glyph not past first advance");
    }

    #[test]
    fn scale_below_one_is_one() {
        let f = m6x11();
        let mut a = Framebuffer::new(32, 16);
        let mut b = Framebuffer::new(32, 16);
        draw_text(&mut a, f, 0, 0, b"Z", 1, 0);
        draw_text(&mut b, f, 0, 0, b"Z", 1, 1);
        assert_eq!(a.px, b.px);
    }
}
