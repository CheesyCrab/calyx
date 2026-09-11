//! Host-owned indexed or opaque RGBA framebuffer (ABI §1, §2).
//!
//! Resolution is data (`new(w, h)`), not a welded constant. Every draw op
//! clips silently at all four edges (ABI §2); nothing here ever panics on
//! an out-of-bounds coordinate or a zero/negative size. This is permanent
//! parity surface: clipping and rounding must match every other runtime
//! byte-for-byte, so the rules are kept dead simple and explicit.

use crate::hash::hash_bytes;

pub struct Framebuffer {
    pub w: i32,
    pub h: i32,
    pub px: Vec<u8>,
    pub true_color: bool,
    palette: [(u8, u8, u8); 256],
    scissor: (i32, i32, i32, i32),
}

impl Framebuffer {
    pub fn new(w: i32, h: i32) -> Self {
        let n = (w.max(0) as usize) * (h.max(0) as usize);
        Framebuffer {
            w,
            h,
            px: vec![0; n],
            true_color: false,
            palette: {
                let mut p = [(0, 0, 0); 256];
                p[..16].copy_from_slice(&crate::palette::SWEETIE_16);
                p
            },
            scissor: (0, 0, w.max(0), h.max(0)),
        }
    }

    #[inline]
    fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= self.scissor.0 && y >= self.scissor.1 && x < self.scissor.2 && y < self.scissor.3
    }

    /// Write one pixel, clipped (ABI §2).
    #[inline]
    pub fn set(&mut self, x: i32, y: i32, idx: u8) {
        if self.in_bounds(x, y) {
            let at = y as usize * self.w as usize + x as usize;
            if self.true_color {
                let (r, g, b) = self.palette[idx as usize];
                self.px[at * 4..at * 4 + 4].copy_from_slice(&[r, g, b, 255]);
            } else {
                self.px[at] = idx;
            }
        }
    }

    pub fn cls(&mut self, idx: u8) {
        if self.true_color {
            let (r, g, b) = self.palette[idx as usize];
            self.rgba_cls(u32::from_be_bytes([r, g, b, 255]));
        } else {
            self.px.fill(idx);
        }
    }

    pub fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, idx: u8) {
        if self.true_color {
            let (r, g, b) = self.palette[idx as usize];
            self.rgba_rect(x, y, w, h, u32::from_be_bytes([r, g, b, 255]));
            return;
        }
        let Some((x0, y0, x1, y1)) = self.clipped_rect(x, y, w, h) else {
            return;
        };
        let stride = self.w as usize;
        for yy in y0..y1 {
            let start = yy * stride + x0;
            self.px[start..start + (x1 - x0)].fill(idx);
        }
    }

    pub fn hline(&mut self, x: i32, y: i32, w: i32, idx: u8) {
        self.rect(x, y, w, 1, idx);
    }
    pub fn vline(&mut self, x: i32, y: i32, h: i32, idx: u8) {
        self.rect(x, y, 1, h, idx);
    }

    fn clipped_rect(&self, x: i32, y: i32, w: i32, h: i32) -> Option<(usize, usize, usize, usize)> {
        if w <= 0 || h <= 0 || self.w <= 0 || self.h <= 0 {
            return None;
        }
        let x0 = i64::from(x)
            .max(i64::from(self.scissor.0))
            .min(i64::from(self.scissor.2));
        let y0 = i64::from(y)
            .max(i64::from(self.scissor.1))
            .min(i64::from(self.scissor.3));
        let x1 = (i64::from(x) + i64::from(w))
            .max(i64::from(self.scissor.0))
            .min(i64::from(self.scissor.2));
        let y1 = (i64::from(y) + i64::from(h))
            .max(i64::from(self.scissor.1))
            .min(i64::from(self.scissor.3));
        (x0 < x1 && y0 < y1).then_some((x0 as usize, y0 as usize, x1 as usize, y1 as usize))
    }

    /// Copy an 8bpp indexed source (`sw × sh`, row-major) to `(x, y)`,
    /// nearest-neighbor scaled into `dw × dh` (ABI §4 Drawing). `flags`:
    /// bit 0 flip-x, bit 1 flip-y, bit 2 color-key (source index 0 skipped).
    /// Scaling uses floor mapping inside the clipped destination.
    // The argument list is the permanent `blit` host import shape from ABI §4.
    #[allow(clippy::too_many_arguments)]
    pub fn blit(
        &mut self,
        src: &[u8],
        sw: i32,
        sh: i32,
        x: i32,
        y: i32,
        dw: i32,
        dh: i32,
        flags: i32,
    ) {
        if sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0 {
            return;
        }
        if !self.true_color && sw == dw && sh == dh && self.blit_1to1(src, sw, sh, x, y, flags) {
            return;
        }
        self.blit_region(
            src,
            sw,
            sh,
            0,
            0,
            sw,
            sh,
            x,
            y,
            dw,
            dh,
            flags & 7,
            0xffffff,
            255,
        );
    }

    fn blit_1to1(&mut self, src: &[u8], sw: i32, sh: i32, x: i32, y: i32, flags: i32) -> bool {
        if sw <= 0 || sh <= 0 {
            return false;
        }
        let Some((x0, y0, x1, y1)) = self.clipped_rect(x, y, sw, sh) else {
            return true;
        };
        let sw = sw as usize;
        let sh = sh as usize;
        let flip_x = flags & 1 != 0;
        let flip_y = flags & 2 != 0;
        let color_key = flags & 4 != 0;
        let source_x0 = (x0 as i64 - i64::from(x)) as usize;
        let source_y0 = (y0 as i64 - i64::from(y)) as usize;
        let copy_width = x1 - x0;
        let stride = self.w as usize;

        if !flip_x && !color_key {
            for row in 0..(y1 - y0) {
                let logical_y = source_y0 + row;
                let source_y = if flip_y {
                    sh - 1 - logical_y
                } else {
                    logical_y
                };
                let source_at = source_y * sw + source_x0;
                let available = src.len().saturating_sub(source_at).min(copy_width);
                if available == 0 {
                    continue;
                }
                let target_at = (y0 + row) * stride + x0;
                self.px[target_at..target_at + available]
                    .copy_from_slice(&src[source_at..source_at + available]);
            }
            return true;
        }

        for row in 0..(y1 - y0) {
            let logical_y = source_y0 + row;
            let source_y = if flip_y {
                sh - 1 - logical_y
            } else {
                logical_y
            };
            let target_at = (y0 + row) * stride + x0;
            for column in 0..copy_width {
                let logical_x = source_x0 + column;
                let source_x = if flip_x {
                    sw - 1 - logical_x
                } else {
                    logical_x
                };
                let Some(&index) = src.get(source_y * sw + source_x) else {
                    continue;
                };
                if !color_key || index != 0 {
                    self.px[target_at + column] = index;
                }
            }
        }
        true
    }

    pub fn set_color_mode(&mut self, true_color: bool) {
        self.true_color = true_color;
        self.clip_reset();
        self.px =
            vec![
                0;
                self.w.max(0) as usize * self.h.max(0) as usize * if true_color { 4 } else { 1 }
            ];
        if true_color {
            self.rgba_cls(0);
        }
    }
    pub fn set_palette(&mut self, palette: &[(u8, u8, u8)]) {
        self.palette.fill((0, 0, 0));
        self.palette[..palette.len()].copy_from_slice(palette);
    }
    pub fn rgb_at(&self, at: usize, palette: &[(u8, u8, u8)]) -> (u8, u8, u8) {
        if self.true_color {
            (self.px[at * 4], self.px[at * 4 + 1], self.px[at * 4 + 2])
        } else {
            palette
                .get(self.px[at] as usize)
                .copied()
                .unwrap_or((0, 0, 0))
        }
    }
    pub fn clip(&mut self, x: i32, y: i32, w: i32, h: i32) {
        let x0 = x.clamp(0, self.w.max(0));
        let y0 = y.clamp(0, self.h.max(0));
        let x1 = (i64::from(x) + i64::from(w.max(0))).clamp(0, i64::from(self.w.max(0))) as i32;
        let y1 = (i64::from(y) + i64::from(h.max(0))).clamp(0, i64::from(self.h.max(0))) as i32;
        self.scissor = (x0, y0, x1.max(x0), y1.max(y0));
    }
    pub fn clip_reset(&mut self) {
        self.scissor = (0, 0, self.w.max(0), self.h.max(0));
    }
    pub fn rgba_cls(&mut self, rgba: u32) {
        let [r, g, b, _] = rgba.to_be_bytes();
        for p in self.px.chunks_exact_mut(4) {
            p.copy_from_slice(&[r, g, b, 255]);
        }
    }
    fn blend_at(&mut self, at: usize, rgba: [u8; 4]) {
        let a = u32::from(rgba[3]);
        if a == 0 {
            return;
        }
        let dest = &mut self.px[at * 4..at * 4 + 4];
        if a == 255 {
            dest.copy_from_slice(&rgba);
            return;
        }
        for c in 0..3 {
            dest[c] = ((u32::from(rgba[c]) * a + u32::from(dest[c]) * (255 - a) + 127) / 255) as u8;
        }
        dest[3] = 255;
    }
    pub fn rgba_rect(&mut self, x: i32, y: i32, w: i32, h: i32, rgba: u32) {
        let Some((x0, y0, x1, y1)) = self.clipped_rect(x, y, w, h) else {
            return;
        };
        let rgba = rgba.to_be_bytes();
        if rgba[3] == 0 {
            return;
        }
        if rgba[3] == 255 {
            for yy in y0..y1 {
                let row =
                    &mut self.px[(yy * self.w as usize + x0) * 4..(yy * self.w as usize + x1) * 4];
                for pixel in row.chunks_exact_mut(4) {
                    pixel.copy_from_slice(&rgba);
                }
            }
            return;
        }
        for yy in y0..y1 {
            for xx in x0..x1 {
                self.blend_at(yy * self.w as usize + xx, rgba);
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn blit_region(
        &mut self,
        src: &[u8],
        sw: i32,
        _sh: i32,
        sx: i32,
        sy: i32,
        rw: i32,
        rh: i32,
        x: i32,
        y: i32,
        dw: i32,
        dh: i32,
        flags: i32,
        tint: u32,
        opacity: u8,
    ) {
        if rw <= 0 || rh <= 0 {
            return;
        }
        let Some((x0, y0, x1, y1)) = self.clipped_rect(x, y, dw, dh) else {
            return;
        };
        if self.true_color && opacity == 0 {
            return;
        }
        let rgba_source = flags & 8 != 0;
        let untinted = tint == 0xffffff;
        let tint = [
            ((tint >> 16) & 255) as u8,
            ((tint >> 8) & 255) as u8,
            (tint & 255) as u8,
        ];
        for yy in y0..y1 {
            let mut ry = ((yy as i64 - i64::from(y)) * i64::from(rh) / i64::from(dh)) as i32;
            if flags & 2 != 0 {
                ry = rh - 1 - ry;
            }
            for xx in x0..x1 {
                let mut rx = ((xx as i64 - i64::from(x)) * i64::from(rw) / i64::from(dw)) as i32;
                if flags & 1 != 0 {
                    rx = rw - 1 - rx;
                }
                let source = (sy as usize + ry as usize) * sw as usize + sx as usize + rx as usize;
                let at = yy * self.w as usize + xx;
                let mut color = if rgba_source {
                    let Some(bytes) = src.get(source * 4..source * 4 + 4) else {
                        continue;
                    };
                    [bytes[0], bytes[1], bytes[2], bytes[3]]
                } else {
                    let Some(&idx) = src.get(source) else {
                        continue;
                    };
                    if flags & 4 != 0 && idx == 0 {
                        continue;
                    }
                    if !self.true_color {
                        self.px[at] = idx;
                        continue;
                    }
                    let (r, g, b) = self.palette[idx as usize];
                    [r, g, b, 255]
                };
                if !untinted {
                    for c in 0..3 {
                        color[c] = ((u32::from(color[c]) * u32::from(tint[c]) + 127) / 255) as u8;
                    }
                }
                color[3] = ((u32::from(color[3]) * u32::from(opacity) + 127) / 255) as u8;
                self.blend_at(at, color);
            }
        }
    }

    /// FNV-1a-64 over canonical index or RGBA bytes, row-major (ABI §6a).
    pub fn hash(&self) -> u64 {
        hash_bytes(&self.px)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_edges_tint_and_opacity_have_literal_results() {
        let mut fb = Framebuffer::new(5, 1);
        fb.set_color_mode(true);
        fb.rgba_cls(0x14283cff);
        for (x, a) in [0u32, 1, 127, 254, 255].into_iter().enumerate() {
            fb.rgba_rect(x as i32, 0, 1, 1, 0xc8643200 | a);
        }
        assert_eq!(
            fb.px,
            [
                20, 40, 60, 255, 21, 40, 60, 255, 110, 70, 55, 255, 199, 100, 50, 255, 200, 100,
                50, 255
            ]
        );
        fb.rgba_cls(0x14283cff);
        fb.blit_region(
            &[201, 99, 51, 127],
            1,
            1,
            0,
            0,
            1,
            1,
            0,
            0,
            1,
            1,
            8,
            0x804020,
            129,
        );
        assert_eq!(&fb.px[..4], &[40, 36, 46, 255]);
    }
    #[test]
    fn clips_scale_regions_and_huge_destinations() {
        let mut fb = Framebuffer::new(4, 2);
        fb.cls(9);
        fb.clip(1, 0, 2, 1);
        fb.blit_region(
            &[1, 2, 3, 4, 5, 6],
            3,
            2,
            1,
            0,
            2,
            2,
            0,
            0,
            4,
            2,
            1,
            0xffffff,
            255,
        );
        assert_eq!(fb.px, [9, 3, 2, 9, 9, 9, 9, 9]);
        fb.blit(&[7], 1, 1, -1, 0, i32::MAX, i32::MAX, 0);
        assert_eq!(fb.px, [9, 7, 7, 9, 9, 9, 9, 9]);
        fb.cls(8);
        assert_eq!(fb.px, [8; 8]);
        fb.clip_reset();
        fb.rect(0, 0, 4, 2, 1);
        assert_eq!(fb.px, [1; 8]);
    }
    #[test]
    fn palette_changes_are_not_retroactive_in_true_color() {
        let mut fb = Framebuffer::new(2, 1);
        fb.set_color_mode(true);
        fb.set(0, 0, 1);
        fb.set_palette(&[(3, 4, 5), (6, 7, 8)]);
        fb.set(1, 0, 1);
        assert_eq!(fb.px, [255, 255, 255, 255, 6, 7, 8, 255]);
        fb.clip(0, 0, 0, 0);
        fb.set_color_mode(true);
        fb.set(0, 0, 0);
        assert_eq!(&fb.px[..4], &[3, 4, 5, 255]);
    }

    fn scalar_blit(fb: &mut Framebuffer, src: &[u8], sw: i32, sh: i32, x: i32, y: i32, flags: i32) {
        let flip_x = flags & 1 != 0;
        let flip_y = flags & 2 != 0;
        let color_key = flags & 4 != 0;
        for dy in 0..sh {
            let sy = if flip_y { sh - 1 - dy } else { dy };
            for dx in 0..sw {
                let sx = if flip_x { sw - 1 - dx } else { dx };
                let Some(&idx) = src.get((sy * sw + sx) as usize) else {
                    continue;
                };
                if !color_key || idx != 0 {
                    let tx = i64::from(x) + i64::from(dx);
                    let ty = i64::from(y) + i64::from(dy);
                    if let (Ok(tx), Ok(ty)) = (i32::try_from(tx), i32::try_from(ty)) {
                        fb.set(tx, ty, idx);
                    }
                }
            }
        }
    }

    #[test]
    fn fast_1to1_blit_matches_scalar_for_clipping_flips_keys_and_short_sources() {
        let src = [1, 0, 2, 3, 4, 5, 0, 6, 7, 8, 9, 10];
        for flags in 0..16 {
            for &(x, y) in &[(-5, -4), (-1, 1), (0, 0), (5, 4), (i32::MAX, 0)] {
                for len in 0..=src.len() {
                    let mut want = Framebuffer::new(7, 6);
                    let mut got = Framebuffer::new(7, 6);
                    want.cls(13);
                    got.cls(13);
                    scalar_blit(&mut want, &src[..len], 4, 3, x, y, flags);
                    assert!(got.blit_1to1(&src[..len], 4, 3, x, y, flags));
                    assert_eq!(got.px, want.px, "flags={flags} pos={x},{y} len={len}");
                }
            }
        }
    }

    #[test]
    fn new_is_cleared_to_zero() {
        let fb = Framebuffer::new(4, 3);
        assert_eq!(fb.px.len(), 12);
        assert!(fb.px.iter().all(|&p| p == 0));
    }

    #[test]
    fn set_clips_silently() {
        let mut fb = Framebuffer::new(4, 4);
        fb.set(-1, 0, 9);
        fb.set(0, -1, 9);
        fb.set(4, 0, 9);
        fb.set(0, 4, 9);
        assert!(fb.px.iter().all(|&p| p == 0)); // nothing landed
        fb.set(1, 2, 7);
        assert_eq!(fb.px[2 * 4 + 1], 7);
    }

    #[test]
    fn rect_clips_at_edges_and_ignores_nonpositive() {
        let mut fb = Framebuffer::new(4, 4);
        fb.rect(2, 2, 100, 100, 5); // overruns far past the edge
        assert_eq!(fb.px[2 * 4 + 2], 5);
        assert_eq!(fb.px[3 * 4 + 3], 5);
        fb.cls(0);
        fb.rect(0, 0, 0, 5, 5); // zero width
        fb.rect(0, 0, 5, -3, 5); // negative height
        assert!(fb.px.iter().all(|&p| p == 0));
    }

    #[test]
    fn rect_far_origin_does_not_overflow() {
        let mut fb = Framebuffer::new(4, 4);
        fb.rect(i32::MAX - 1, 0, 10, 1, 5); // saturating range, no panic
        fb.rect(0, i32::MAX - 1, 1, 10, 5);
        assert!(fb.px.iter().all(|&p| p == 0));
    }

    #[test]
    fn lines() {
        let mut fb = Framebuffer::new(5, 5);
        fb.hline(1, 2, 3, 4);
        assert_eq!(&fb.px[2 * 5..2 * 5 + 5], &[0, 4, 4, 4, 0]);
        fb.cls(0);
        fb.vline(3, 1, 2, 6);
        assert_eq!(fb.px[8], 6);
        assert_eq!(fb.px[2 * 5 + 3], 6);
        assert_eq!(fb.px[3 * 5 + 3], 0);
    }

    #[test]
    fn blit_1to1_with_flips_and_color_key() {
        // 2x2 source: top row [1,2], bottom [0,3].
        let src = [1u8, 2, 0, 3];
        let mut fb = Framebuffer::new(4, 4);

        fb.blit(&src, 2, 2, 0, 0, 2, 2, 0); // plain 1:1
        assert_eq!(&fb.px[0..2], &[1, 2]);
        assert_eq!(&fb.px[4..6], &[0, 3]);

        fb.cls(0);
        fb.blit(&src, 2, 2, 0, 0, 2, 2, 1); // flip-x
        assert_eq!(&fb.px[0..2], &[2, 1]);

        fb.cls(0);
        fb.blit(&src, 2, 2, 0, 0, 2, 2, 2); // flip-y
        assert_eq!(&fb.px[0..2], &[0, 3]);

        fb.cls(9);
        fb.blit(&src, 2, 2, 0, 0, 2, 2, 4); // color-key: index 0 transparent
        assert_eq!(fb.px[4], 9); // the source's index-0 hole kept background
        assert_eq!(fb.px[5], 3);
    }

    #[test]
    fn hash_tracks_contents() {
        let mut fb = Framebuffer::new(2, 2);
        let h0 = fb.hash();
        fb.set(0, 0, 1);
        assert_ne!(fb.hash(), h0);
    }
}
