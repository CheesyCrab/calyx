//! The terminal presenter — one cart → a second surface (the multi-presenter
//! thesis). A dumb sink on the already-verified framebuffer: half-block
//! Unicode with 24-bit color, downsampled to fit, redrawn each frame. It is
//! explicitly *unverified* (README, "Scope frontiers"); nothing it does
//! changes the run's hash.

use std::io::Write;
use std::time::{Duration, Instant};

use calyx_core::{FrameRecord, FrameSink, Framebuffer};

use crate::timing::PresentationRate;

pub struct TerminalSink {
    palette: Vec<(u8, u8, u8)>,
    rate: PresentationRate,
    interval: Duration,
    next_present: Option<Instant>,
    scale: TerminalScale,
    last_layout: Option<(i32, i32)>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalScale {
    Auto,
    Clean,
}

impl TerminalScale {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("auto") {
            "auto" => Ok(Self::Auto),
            "clean" => Ok(Self::Clean),
            other => Err(format!("--term-scale must be auto|clean, got '{other}'")),
        }
    }
}

impl TerminalSink {
    pub fn new(rate: PresentationRate, scale: TerminalScale) -> Self {
        TerminalSink {
            palette: Vec::new(),
            rate,
            interval: Duration::from_nanos(1_000_000_000 / u64::from(rate.fps())),
            next_present: None,
            scale,
            last_layout: None,
        }
    }

    fn sample_scale(&self, w: i32, h: i32) -> i32 {
        if self.scale == TerminalScale::Clean {
            return 1;
        }
        let (cols, rows) = crossterm::terminal::size().unwrap_or((96, 40));
        fit_scale(w, h, i32::from(cols), i32::from(rows))
    }
}

fn fit_scale(w: i32, h: i32, cols: i32, rows: i32) -> i32 {
    let cols = cols.max(1);
    let rows = rows.max(1);
    let x_scale = (w + cols - 1) / cols;
    let y_scale = (h + rows * 2 - 1) / (rows * 2);
    x_scale.max(y_scale).max(1)
}

impl FrameSink for TerminalSink {
    fn begin(&mut self, _w: i32, _h: i32, palette_rgb: &[(u8, u8, u8)]) {
        self.palette = palette_rgb.to_vec();
        self.last_layout = None;
        self.next_present = Some(Instant::now() + self.interval);
        // Clear screen, hide cursor.
        print!("\x1b[2J\x1b[?25l");
        let _ = std::io::stdout().flush();
    }

    fn frame(&mut self, fb: &Framebuffer, rec: &FrameRecord) {
        if !self.rate.should_present(rec.f + 1) {
            return;
        }
        let (w, h) = (fb.w, fb.h);
        // One cell covers scale×(scale*2) source pixels. Auto chooses the
        // smallest integer scale that fits both live terminal dimensions;
        // clean is exact 1×2 half-block output regardless of terminal size.
        let sx = self.sample_scale(w, h);
        let sy = sx * 2;

        let layout = ((w + sx - 1) / sx, (h + sy - 1) / sy);
        let mut out = if self.last_layout == Some(layout) {
            String::from("\x1b[H")
        } else {
            self.last_layout = Some(layout);
            String::from("\x1b[2J\x1b[H")
        };
        let mut y = 0;
        while y < h {
            let mut x = 0;
            while x < w {
                let (tr, tg, tb) = fb.rgb_at((y * w + x) as usize, &self.palette);
                let (br, bg, bb) =
                    fb.rgb_at(((y + sy / 2).min(h - 1) * w + x) as usize, &self.palette);
                out.push_str(&format!(
                    "\x1b[38;2;{tr};{tg};{tb}m\x1b[48;2;{br};{bg};{bb}m\u{2580}"
                ));
                x += sx;
            }
            out.push_str("\x1b[0m");
            y += sy;
            if y < h {
                out.push('\n');
            }
        }
        print!("{out}");
        let _ = std::io::stdout().flush();
        let now = Instant::now();
        if let Some(deadline) = self.next_present {
            if now < deadline {
                std::thread::sleep(deadline - now);
                self.next_present = Some(deadline + self.interval);
            } else {
                self.next_present = Some(now + self.interval);
            }
        }
    }

    fn end(&mut self, _report: &calyx_core::RunReport) {
        // Restore cursor.
        print!("\x1b[0m\x1b[?25h");
        let _ = std::io::stdout().flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_scale_is_exact() {
        let sink = TerminalSink::new(PresentationRate::Hz30, TerminalScale::Clean);
        assert_eq!(sink.sample_scale(320, 240), 1);
    }

    #[test]
    fn scale_parser_rejects_unknown_modes() {
        assert_eq!(
            TerminalScale::parse(Some("auto")).unwrap(),
            TerminalScale::Auto
        );
        assert_eq!(
            TerminalScale::parse(Some("clean")).unwrap(),
            TerminalScale::Clean
        );
        assert!(TerminalScale::parse(Some("tiny")).is_err());
    }

    #[test]
    fn auto_fit_preserves_integer_pixel_aspect() {
        assert_eq!(fit_scale(320, 240, 320, 120), 1);
        assert_eq!(fit_scale(320, 240, 160, 60), 2);
        assert_eq!(fit_scale(320, 240, 120, 40), 3);
        assert_eq!(fit_scale(320, 240, 80, 100), 4);
    }
}
