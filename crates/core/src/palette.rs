//! Palette — SWEETIE_16 default, optional per-cart override (ABI §1.1, §4).
//!
//! The framebuffer hash is over *index* bytes, so a `set_palette` call is
//! invisible to it. The palette is therefore recorded as verified state in
//! its own right: `id()` is `"SWEETIE_16"` or `"custom:<digest>"`, the
//! digest being FNV-1a-64 over the declared `3 × count` RGB bytes (ABI §6a).

use crate::hash::{hash_bytes, hex16};

/// The Calyx default palette, copied verbatim from
/// `godot/shared/console_config.gd` (ABI §1.1).
pub const SWEETIE_16: [(u8, u8, u8); 16] = [
    (0x00, 0x00, 0x00), // 0 BLACK
    (0xff, 0xff, 0xff), // 1 WHITE
    (0x1a, 0x1c, 0x2c), // 2 DARK_BLUE
    (0x5d, 0x27, 0x5d), // 3 PURPLE
    (0xb1, 0x3e, 0x53), // 4 RED
    (0xef, 0x7d, 0x57), // 5 ORANGE
    (0xff, 0xcd, 0x75), // 6 YELLOW
    (0xa7, 0xf0, 0x70), // 7 LIGHT_GREEN
    (0x38, 0xb7, 0x64), // 8 GREEN
    (0x25, 0x71, 0x79), // 9 TEAL
    (0x29, 0x36, 0x6f), // 10 NAVY
    (0x3b, 0x5d, 0xc9), // 11 BLUE
    (0x41, 0xa6, 0xf6), // 12 LIGHT_BLUE
    (0x73, 0xef, 0xf7), // 13 CYAN
    (0x94, 0xb0, 0xc2), // 14 LIGHT_GRAY
    (0x56, 0x6c, 0x86), // 15 DARK_GRAY
];

pub struct Palette {
    entries: Vec<(u8, u8, u8)>,
    /// `Some` once a cart declared its own palette at `start()`.
    custom_digest: Option<u64>,
}

impl Palette {
    pub fn sweetie16() -> Self {
        Palette {
            entries: SWEETIE_16.to_vec(),
            custom_digest: None,
        }
    }

    /// Replace the palette from index 0 with `count` packed RGB888 triples
    /// (`rgb.len()` must be `count * 3`). Valid only during `start()`; the
    /// caller (host) enforces that and the `count <= 256` bound.
    pub fn set_from_rgb(&mut self, rgb: &[u8], count: usize) {
        for i in 0..count {
            let entry = (rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
            if i < self.entries.len() {
                self.entries[i] = entry;
            } else {
                self.entries.push(entry);
            }
        }
        // Digest is over exactly the declared bytes, mirroring ABI §6a.
        self.custom_digest = Some(hash_bytes(&rgb[..count * 3]));
    }

    /// RGB for a palette index; out-of-range reads as black (presenter-side).
    pub fn rgb(&self, idx: u8) -> (u8, u8, u8) {
        self.entries.get(idx as usize).copied().unwrap_or((0, 0, 0))
    }

    /// The full effective palette (for presenters that map indices to RGB).
    pub fn entries(&self) -> &[(u8, u8, u8)] {
        &self.entries
    }

    /// The palette as verified state (ABI §6a).
    pub fn id(&self) -> String {
        match self.custom_digest {
            None => "SWEETIE_16".to_string(),
            Some(d) => format!("custom:{}", hex16(d)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_sweetie16() {
        let p = Palette::sweetie16();
        assert_eq!(p.id(), "SWEETIE_16");
        assert_eq!(p.rgb(1), (0xff, 0xff, 0xff));
        assert_eq!(p.rgb(4), (0xb1, 0x3e, 0x53));
    }

    #[test]
    fn out_of_range_index_is_black() {
        let p = Palette::sweetie16();
        assert_eq!(p.rgb(200), (0, 0, 0));
    }

    #[test]
    fn custom_palette_overrides_and_digests() {
        let mut p = Palette::sweetie16();
        let rgb = [10u8, 20, 30, 40, 50, 60];
        p.set_from_rgb(&rgb, 2);
        assert_eq!(p.rgb(0), (10, 20, 30));
        assert_eq!(p.rgb(1), (40, 50, 60));
        // Index 2+ keeps the SWEETIE_16 tail (unchanged, presenter-only).
        assert_eq!(p.rgb(2), SWEETIE_16[2]);
        assert_eq!(p.id(), format!("custom:{}", hex16(hash_bytes(&rgb))));
    }

    #[test]
    fn digest_is_only_over_declared_bytes() {
        let mut a = Palette::sweetie16();
        let mut b = Palette::sweetie16();
        a.set_from_rgb(&[1, 2, 3, 9, 9, 9], 1); // trailing bytes ignored
        b.set_from_rgb(&[1, 2, 3], 1);
        assert_eq!(a.id(), b.id());
    }
}
