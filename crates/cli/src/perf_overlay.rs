//! SDL presenter performance instrumentation and its unverified RGB overlay.
//!
//! These measurements never enter the cart framebuffer or ABI. They describe
//! the host presentation path: Wasm simulation, indexed-to-RGB conversion,
//! and SDL upload/copy/present work.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct PerfSample {
    pub presents: u32,
    pub sim_samples: u32,
    pub rgb_samples: u32,
    pub sdl_samples: u32,
    pub fps: f64,
    pub sim_ms: f64,
    pub rgb_ms: f64,
    pub sdl_ms: f64,
}

pub struct PerfStats {
    window_start: Instant,
    presents: u32,
    sim_total: Duration,
    sim_samples: u32,
    rgb_total: Duration,
    rgb_samples: u32,
    sdl_total: Duration,
    sdl_samples: u32,
    pub fps: f64,
    pub sim_ms: f64,
    pub rgb_ms: f64,
    pub sdl_ms: f64,
}

impl PerfStats {
    pub fn new(now: Instant) -> Self {
        Self {
            window_start: now,
            presents: 0,
            sim_total: Duration::ZERO,
            sim_samples: 0,
            rgb_total: Duration::ZERO,
            rgb_samples: 0,
            sdl_total: Duration::ZERO,
            sdl_samples: 0,
            fps: 0.0,
            sim_ms: 0.0,
            rgb_ms: 0.0,
            sdl_ms: 0.0,
        }
    }

    pub fn record_sim(&mut self, elapsed: Duration) {
        self.sim_total += elapsed;
        self.sim_samples += 1;
    }

    pub fn record_rgb(&mut self, elapsed: Duration) {
        self.rgb_total += elapsed;
        self.rgb_samples += 1;
    }

    pub fn record_sdl(&mut self, elapsed: Duration) {
        self.sdl_total += elapsed;
        self.sdl_samples += 1;
    }

    pub fn record_present(&mut self, now: Instant) -> Option<PerfSample> {
        self.presents += 1;
        let wall = now.saturating_duration_since(self.window_start);
        if wall < Duration::from_secs(1) {
            return None;
        }
        self.fps = f64::from(self.presents) / wall.as_secs_f64();
        self.sim_ms = mean_ms(self.sim_total, self.sim_samples);
        self.rgb_ms = mean_ms(self.rgb_total, self.rgb_samples);
        self.sdl_ms = mean_ms(self.sdl_total, self.sdl_samples);
        let sample = PerfSample {
            presents: self.presents,
            sim_samples: self.sim_samples,
            rgb_samples: self.rgb_samples,
            sdl_samples: self.sdl_samples,
            fps: self.fps,
            sim_ms: self.sim_ms,
            rgb_ms: self.rgb_ms,
            sdl_ms: self.sdl_ms,
        };
        self.window_start = now;
        self.presents = 0;
        self.sim_total = Duration::ZERO;
        self.sim_samples = 0;
        self.rgb_total = Duration::ZERO;
        self.rgb_samples = 0;
        self.sdl_total = Duration::ZERO;
        self.sdl_samples = 0;
        Some(sample)
    }

    pub fn reset(&mut self, now: Instant) {
        *self = Self::new(now);
    }
}

fn mean_ms(total: Duration, samples: u32) -> f64 {
    if samples == 0 {
        0.0
    } else {
        total.as_secs_f64() * 1000.0 / f64::from(samples)
    }
}

#[derive(Clone, Copy)]
pub enum ChordButton {
    X,
    Y,
    L,
    R,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PerfChordAction {
    ToggleHud,
    ToggleLog,
}

#[derive(Default)]
pub struct PerfChord {
    x: bool,
    y: bool,
    l: bool,
    r: bool,
    x_latched: bool,
    y_latched: bool,
}

impl PerfChord {
    /// Returns one action per face-button press while L+R remain held.
    pub fn set(&mut self, button: ChordButton, down: bool) -> Option<PerfChordAction> {
        match button {
            ChordButton::X => self.x = down,
            ChordButton::Y => self.y = down,
            ChordButton::L => self.l = down,
            ChordButton::R => self.r = down,
        }
        if !self.x {
            self.x_latched = false;
        }
        if !self.y {
            self.y_latched = false;
        }
        if self.x && self.l && self.r && !self.x_latched {
            self.x_latched = true;
            return Some(PerfChordAction::ToggleHud);
        }
        if self.y && self.l && self.r && !self.y_latched {
            self.y_latched = true;
            return Some(PerfChordAction::ToggleLog);
        }
        None
    }

    pub fn any_down(&self) -> bool {
        self.x || self.y || self.l || self.r
    }
}

pub struct PerfLog {
    path: PathBuf,
    started: Instant,
    writer: BufWriter<File>,
}

impl PerfLog {
    pub fn start(dir: &Path, now: Instant) -> Result<Self, String> {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("create performance log directory {}: {e}", dir.display()))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_millis();
        let mut opened = None;
        for suffix in 0..1000 {
            let name = if suffix == 0 {
                format!("calyx-perf-{stamp}.csv")
            } else {
                format!("calyx-perf-{stamp}-{suffix}.csv")
            };
            let path = dir.join(name);
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => {
                    opened = Some((path, file));
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(format!("open performance log {}: {error}", path.display()))
                }
            }
        }
        let (path, file) = opened.ok_or_else(|| {
            format!(
                "could not allocate a unique performance log name in {}",
                dir.display()
            )
        })?;
        let mut writer = BufWriter::new(file);
        writeln!(
            writer,
            "schema,unix_ms,elapsed_ms,screen,width,height,presents,sim_samples,rgb_samples,sdl_samples,fps,sim_ms,rgb_ms,sdl_ms"
        )
        .map_err(|e| format!("write performance log {}: {e}", path.display()))?;
        writer
            .flush()
            .map_err(|e| format!("flush performance log {}: {e}", path.display()))?;
        Ok(Self {
            path,
            started: now,
            writer,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn record(
        &mut self,
        now: Instant,
        screen: &str,
        width: usize,
        height: usize,
        sample: &PerfSample,
    ) -> Result<(), String> {
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_millis();
        let elapsed_ms = now.saturating_duration_since(self.started).as_millis();
        writeln!(
            self.writer,
            "1,{unix_ms},{elapsed_ms},{},{width},{height},{},{},{},{},{:.3},{:.3},{:.3},{:.3}",
            csv_field(screen),
            sample.presents,
            sample.sim_samples,
            sample.rgb_samples,
            sample.sdl_samples,
            sample.fps,
            sample.sim_ms,
            sample.rgb_ms,
            sample.sdl_ms,
        )
        .and_then(|()| self.writer.flush())
        .map_err(|e| format!("write performance log {}: {e}", self.path.display()))
    }

    pub fn finish(mut self) -> Result<PathBuf, String> {
        self.writer
            .flush()
            .map_err(|e| format!("flush performance log {}: {e}", self.path.display()))?;
        Ok(self.path)
    }
}

fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// Draw readable high-contrast diagnostics over an ARGB8888 presenter buffer.
pub fn draw_argb8888(
    stats: &PerfStats,
    logging: bool,
    log_error: bool,
    px: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
) {
    if width < 160
        || height < 100
        || pitch < width.saturating_mul(4)
        || px.len() < pitch.saturating_mul(height)
    {
        return;
    }
    let scale = if width >= 960 {
        3
    } else if width >= 560 {
        2
    } else {
        1
    };
    let mut lines = vec![
        format!("FPS {:>5.1}", stats.fps),
        format!("SIM {:>5.2} MS", stats.sim_ms),
        format!("RGB {:>5.2} MS", stats.rgb_ms),
        format!("SDL {:>5.2} MS", stats.sdl_ms),
    ];
    if logging {
        lines.push("REC LOGGING".to_string());
    } else if log_error {
        lines.push("LOG ERROR".to_string());
    }
    let chars = lines.iter().map(String::len).max().unwrap_or(0);
    let panel_w = (chars * 6 + 8) * scale;
    let panel_h = (lines.len() * 9 + 7) * scale;
    let x0 = 8 * scale;
    let y0 = 8 * scale;
    rect(
        px,
        pitch,
        width,
        height,
        x0,
        y0,
        panel_w,
        panel_h,
        [0, 8, 3],
    );
    outline(
        px,
        pitch,
        width,
        height,
        x0,
        y0,
        panel_w,
        panel_h,
        scale,
        [28, 150, 72],
    );
    for (row, line) in lines.iter().enumerate() {
        text(
            px,
            pitch,
            width,
            height,
            x0 + 4 * scale,
            y0 + (4 + row * 9) * scale,
            scale,
            line,
            if logging && row + 1 == lines.len() {
                [255, 72, 72]
            } else if log_error && row + 1 == lines.len() {
                [255, 193, 57]
            } else {
                [57, 255, 121]
            },
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn rect(
    px: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    color: [u8; 3],
) {
    for py in y..(y + h).min(height) {
        for xx in x..(x + w).min(width) {
            let at = py * pitch + xx * 4;
            let packed = 0xff00_0000
                | (u32::from(color[0]) << 16)
                | (u32::from(color[1]) << 8)
                | u32::from(color[2]);
            px[at..at + 4].copy_from_slice(&packed.to_ne_bytes());
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn outline(
    px: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    t: usize,
    color: [u8; 3],
) {
    rect(px, pitch, width, height, x, y, w, t, color);
    rect(
        px,
        pitch,
        width,
        height,
        x,
        y + h.saturating_sub(t),
        w,
        t,
        color,
    );
    rect(px, pitch, width, height, x, y, t, h, color);
    rect(
        px,
        pitch,
        width,
        height,
        x + w.saturating_sub(t),
        y,
        t,
        h,
        color,
    );
}

#[allow(clippy::too_many_arguments)]
fn text(
    px: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    scale: usize,
    value: &str,
    color: [u8; 3],
) {
    for (i, ch) in value.chars().enumerate() {
        for (row, bits) in glyph(ch).into_iter().enumerate() {
            for col in 0..5 {
                if bits & (1 << (4 - col)) != 0 {
                    rect(
                        px,
                        pitch,
                        width,
                        height,
                        x + (i * 6 + col) * scale,
                        y + row * scale,
                        scale,
                        scale,
                        color,
                    );
                }
            }
        }
    }
}

fn glyph(ch: char) -> [u8; 7] {
    match ch {
        '0' => [14, 17, 19, 21, 25, 17, 14],
        '1' => [4, 12, 4, 4, 4, 4, 14],
        '2' => [14, 17, 1, 2, 4, 8, 31],
        '3' => [30, 1, 1, 14, 1, 1, 30],
        '4' => [2, 6, 10, 18, 31, 2, 2],
        '5' => [31, 16, 16, 30, 1, 1, 30],
        '6' => [14, 16, 16, 30, 17, 17, 14],
        '7' => [31, 1, 2, 4, 8, 8, 8],
        '8' => [14, 17, 17, 14, 17, 17, 14],
        '9' => [14, 17, 17, 15, 1, 1, 14],
        'B' => [30, 17, 17, 30, 17, 17, 30],
        'C' => [14, 17, 16, 16, 16, 17, 14],
        'D' => [30, 17, 17, 17, 17, 17, 30],
        'E' => [31, 16, 16, 30, 16, 16, 31],
        'F' => [31, 16, 16, 30, 16, 16, 16],
        'G' => [14, 17, 16, 23, 17, 17, 14],
        'I' => [31, 4, 4, 4, 4, 4, 31],
        'L' => [16, 16, 16, 16, 16, 16, 31],
        'M' => [17, 27, 21, 21, 17, 17, 17],
        'N' => [17, 25, 21, 19, 17, 17, 17],
        'O' => [14, 17, 17, 17, 17, 17, 14],
        'P' => [30, 17, 17, 30, 16, 16, 16],
        'R' => [30, 17, 17, 30, 20, 18, 17],
        'S' => [15, 16, 16, 14, 1, 1, 30],
        '.' => [0, 0, 0, 0, 0, 12, 12],
        _ => [0; 7],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chord_routes_x_and_y_once_per_face_button_press() {
        let mut chord = PerfChord::default();
        assert_eq!(chord.set(ChordButton::L, true), None);
        assert_eq!(chord.set(ChordButton::R, true), None);
        assert_eq!(
            chord.set(ChordButton::X, true),
            Some(PerfChordAction::ToggleHud)
        );
        assert_eq!(chord.set(ChordButton::X, true), None);
        assert_eq!(chord.set(ChordButton::X, false), None);
        assert_eq!(
            chord.set(ChordButton::Y, true),
            Some(PerfChordAction::ToggleLog)
        );
        assert_eq!(chord.set(ChordButton::Y, true), None);
    }

    #[test]
    fn overlay_draws_bright_pixels_without_touching_dimensions() {
        let stats = PerfStats::new(Instant::now());
        let mut pixels = vec![0; 320 * 240 * 4];
        draw_argb8888(&stats, true, false, &mut pixels, 320 * 4, 320, 240);
        let green = 0xff39_ff79u32.to_ne_bytes();
        let red = 0xffff_4848u32.to_ne_bytes();
        assert!(pixels.chunks_exact(4).any(|p| p == green));
        assert!(pixels.chunks_exact(4).any(|p| p == red));
    }

    #[test]
    fn completed_window_preserves_sample_counts() {
        let now = Instant::now();
        let mut stats = PerfStats::new(now);
        stats.record_sim(Duration::from_millis(6));
        stats.record_rgb(Duration::from_millis(4));
        stats.record_sdl(Duration::from_millis(5));
        let sample = stats.record_present(now + Duration::from_secs(1)).unwrap();
        assert_eq!(sample.presents, 1);
        assert_eq!(sample.sim_samples, 1);
        assert_eq!(sample.rgb_samples, 1);
        assert_eq!(sample.sdl_samples, 1);
        assert!(stats.record_present(now + Duration::from_secs(1)).is_none());
    }

    #[test]
    fn performance_log_writes_a_flushed_csv_sample() {
        let root = std::env::temp_dir().join(format!(
            "calyx-perf-log-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let now = Instant::now();
        let mut log = PerfLog::start(&root, now).unwrap();
        let sample = PerfSample {
            presents: 60,
            sim_samples: 60,
            rgb_samples: 60,
            sdl_samples: 60,
            fps: 59.94,
            sim_ms: 5.8,
            rgb_ms: 3.5,
            sdl_ms: 5.2,
        };
        log.record(
            now + Duration::from_secs(1),
            "calyx — HD, Input Lab",
            1280,
            720,
            &sample,
        )
        .unwrap();
        let path = log.finish().unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("schema,unix_ms,elapsed_ms,screen,width,height"));
        assert!(text
            .contains("\"calyx — HD, Input Lab\",1280,720,60,60,60,60,59.940,5.800,3.500,5.200"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
