//! The headless two-tier state dump (ABI §6a): `status.json` (scanned
//! first, golden-diffed), `frames.jsonl` (one line per frame), and PNG
//! sidecars. The per-frame JSON here is the *single* serializer used for
//! both `calyx run`'s `frames.jsonl` and `calyx bless`'s
//! `frames.golden.jsonl`, so the two are byte-identical by construction.

use std::path::Path;

use calyx_core::{FrameRecord, FrameSink, Framebuffer, RunReport, SysEvent};
use serde_json::{json, Value};

/// One `frames.jsonl` row (ABI §6a). Keys serialize in serde_json's stable
/// (sorted) order, which is what the committed goldens were written with.
/// `system` adds the v1.1 `sys` key — present on every row of a privileged
/// run, absent otherwise, so pre-v1.1 goldens stay byte-identical.
pub fn frame_value(rec: &FrameRecord, system: bool) -> Value {
    let audio: Vec<Value> = rec
        .audio
        .iter()
        .map(|a| json!({"op":"tone","freq":a.freq,"dur":a.dur,"vol":a.vol,"flags":a.flags}))
        .collect();
    let mut row = json!({
        "f": rec.f,
        "hash": format!("{:016x}", rec.hash),
        "btn": rec.btn,
        "audio": audio,
        "trace": rec.trace,
    });
    if system {
        row["sys"] = Value::Array(rec.sys.iter().map(sys_event_value).collect());
    }
    row
}

/// One `sys` event (ABI §4b/§6a v1.1).
pub fn sys_event_value(e: &SysEvent) -> Value {
    match e {
        SysEvent::Launch(i) => json!({"op":"launch","i":i}),
        SysEvent::Exit => json!({"op":"exit"}),
    }
}

/// The `frames.jsonl` body for a whole run.
pub fn frames_jsonl(report: &RunReport) -> String {
    let mut s = String::new();
    for rec in &report.frames {
        s.push_str(&frame_value(rec, report.system).to_string());
        s.push('\n');
    }
    s
}

/// `status.json` — the quick status the golden test diffs (ABI §6a).
pub fn status_value(report: &RunReport) -> Value {
    let mut status = json!({
        "cart": report.cart,
        "profile": { "w": report.w, "h": report.h, "palette": report.palette_id },
        "frames_run": report.frames_run,
        "run_hash": report.run_hex(),
        "final_hash": report.final_hex(),
        "input": report.input_label,
    });
    if report.true_color {
        status["profile"]["color"] = json!("rgba8888");
    }
    if let Some(fault) = &report.fault {
        status["fault"] = json!({ "f": fault.f, "kind": fault.kind, "msg": fault.msg });
    }
    status
}

/// Write `status.json` + `frames.jsonl` for a finished run.
pub fn write_status_and_frames(report: &RunReport, out: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(out)?;
    let status = serde_json::to_string_pretty(&status_value(report)).unwrap();
    std::fs::write(out.join("status.json"), status)?;
    std::fs::write(out.join("frames.jsonl"), frames_jsonl(report))?;
    Ok(())
}

/// A presenter that drops PNG sidecars: the final frame always, plus every
/// `every`-th frame when `every > 0` (ABI §6a). Palette-applied, for
/// eyeballing — the unverified side of the boundary.
pub struct PngSink {
    dir: std::path::PathBuf,
    every: i32,
    total: i32,
    palette: Vec<(u8, u8, u8)>,
}

impl PngSink {
    pub fn new(dir: impl Into<std::path::PathBuf>, every: i32, total: i32) -> Self {
        PngSink {
            dir: dir.into(),
            every,
            total,
            palette: Vec::new(),
        }
    }

    fn write_png(&self, f: i32, fb: &Framebuffer) {
        save_png(&self.dir, f, fb, &self.palette);
    }
}

/// Write one palette-applied `frame_NNNN.png` sidecar — shared by
/// `calyx run`'s PngSink and the headless console's `--out` dump.
pub fn save_png(dir: &Path, f: i32, fb: &Framebuffer, palette: &[(u8, u8, u8)]) {
    let mut img = image::RgbImage::new(fb.w as u32, fb.h as u32);
    for i in 0..fb.w as usize * fb.h as usize {
        let (r, g, b) = fb.rgb_at(i, palette);
        let x = (i as i32 % fb.w) as u32;
        let y = (i as i32 / fb.w) as u32;
        img.put_pixel(x, y, image::Rgb([r, g, b]));
    }
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(format!("frame_{f:04}.png"));
    if let Err(e) = img.save(&path) {
        eprintln!("warning: could not write {}: {e}", path.display());
    }
}

impl FrameSink for PngSink {
    fn begin(&mut self, _w: i32, _h: i32, palette_rgb: &[(u8, u8, u8)]) {
        self.palette = palette_rgb.to_vec();
    }
    fn frame(&mut self, fb: &Framebuffer, rec: &FrameRecord) {
        let is_sample = self.every > 0 && rec.f % self.every == 0;
        let is_final = rec.f == self.total - 1;
        if is_sample || is_final {
            self.write_png(rec.f, fb);
        }
    }
}
