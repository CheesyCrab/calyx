//! Product soak: representative public carts, repeatedly loaded and dropped
//! in one release process. This is a deliberately small regression tripwire,
//! not a benchmark framework.

use std::path::Path;
use std::time::Instant;

use calyx_core::{run as core_run, Feed, RunConfig};

const CASES: [(&str, &str); 4] = [
    ("horizon-burn", "horizon-burn"),
    ("wormtide", "wormtide"),
    ("seaway-dig", "seaway-dig"),
    ("micro-ai-war", "micro-ai-war"),
];

struct Case {
    name: String,
    wasm: Vec<u8>,
    feed_json: String,
    frames: i32,
    expected: u64,
}

fn string_at(doc: &toml_edit::DocumentMut, table: &str, key: &str) -> Result<String, String> {
    doc.get(table)
        .and_then(|t| t.get(key))
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| format!("{table}.{key} missing"))
}

fn load_case(suite: &Path, carts: &Path, fixture: &str, product: &str) -> Result<Case, String> {
    let dir = suite.join("carts").join(fixture);
    let manifest_path = dir.join("cart.toml");
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read {}: {e}", manifest_path.display()))?;
    let doc: toml_edit::DocumentMut = text
        .parse()
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;
    let frames = doc
        .get("run")
        .and_then(|t| t.get("frames"))
        .and_then(|v| v.as_integer())
        .ok_or_else(|| format!("{}: run.frames missing", manifest_path.display()))?
        as i32;
    let feed_name = string_at(&doc, "run", "feed")?;
    let feed_text = std::fs::read_to_string(dir.join(&feed_name))
        .map_err(|e| format!("read {fixture}/{feed_name}: {e}"))?;
    let expected_hex = string_at(&doc, "expected", "run_hash")?;
    let expected = u64::from_str_radix(&expected_hex, 16)
        .map_err(|e| format!("{fixture}: bad expected run_hash: {e}"))?;
    let wasm_path = carts.join(product).join("cart.wasm");
    let wasm = std::fs::read(&wasm_path).map_err(|e| {
        format!(
            "read {}: {e} (run catalog build first)",
            wasm_path.display()
        )
    })?;
    Ok(Case {
        name: fixture.to_string(),
        wasm,
        feed_json: feed_text,
        frames,
        expected,
    })
}

#[cfg(unix)]
fn peak_rss_bytes() -> Option<u64> {
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
        return None;
    }
    #[cfg(target_os = "macos")]
    return Some(usage.ru_maxrss as u64);
    #[cfg(not(target_os = "macos"))]
    return Some(usage.ru_maxrss as u64 * 1024);
}

#[cfg(not(unix))]
fn peak_rss_bytes() -> Option<u64> {
    None
}

fn mib(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

pub fn run(
    suite: &Path,
    carts_root: &Path,
    cycles: u32,
    out: &Path,
    max_rss_mib: u64,
    max_growth_mib: i64,
    min_fps: f64,
) -> Result<bool, String> {
    let cases: Vec<Case> = CASES
        .iter()
        .map(|(fixture, product)| load_case(suite, carts_root, fixture, product))
        .collect::<Result<_, _>>()?;
    let start_rss = peak_rss_bytes()
        .ok_or("soak: peak RSS measurement is currently supported on Unix hosts only")?;
    let started = Instant::now();
    let mut total_frames: u64 = 0;
    let mut samples = Vec::new();
    let mut runs = Vec::new();

    for cycle in 0..cycles {
        for case in &cases {
            let mut cfg = RunConfig::new(case.frames);
            cfg.feed =
                Feed::from_json(&case.feed_json).map_err(|e| format!("feed {}: {e}", case.name))?;
            cfg.input_label = format!("soak:{}", case.name);
            let report = core_run(&case.wasm, &cfg, &case.name)
                .map_err(|e| format!("soak {} cycle {}: {e}", case.name, cycle + 1))?;
            if report.run_hash != case.expected {
                return Err(format!(
                    "soak {} cycle {}: run hash {:016x}, expected {:016x}",
                    case.name,
                    cycle + 1,
                    report.run_hash,
                    case.expected
                ));
            }
            total_frames += case.frames as u64;
            runs.push(serde_json::json!({
                "cycle": cycle + 1,
                "cart": case.name,
                "frames": case.frames,
                "run_hash": format!("{:016x}", report.run_hash),
            }));
            drop(report);
        }
        let rss = peak_rss_bytes().ok_or("soak: getrusage failed while sampling peak RSS")?;
        samples.push(serde_json::json!({"cycle": cycle + 1, "peak_rss_bytes": rss}));
        eprintln!(
            "soak: cycle {}/{} peak RSS {:.1} MiB",
            cycle + 1,
            cycles,
            mib(rss)
        );
    }

    let elapsed = started.elapsed().as_secs_f64();
    let fps = total_frames as f64 / elapsed.max(f64::EPSILON);
    let peak = peak_rss_bytes().ok_or("soak: getrusage failed while reading final peak RSS")?;
    let first_cycle = samples
        .first()
        .and_then(|v| v.get("peak_rss_bytes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(start_rss);
    let growth = peak as i64 - first_cycle as i64;
    let rss_ok = peak <= max_rss_mib * 1024 * 1024;
    let growth_ok = growth <= max_growth_mib * 1024 * 1024;
    let fps_ok = fps >= min_fps;
    let passed = rss_ok && growth_ok && fps_ok;
    let value = serde_json::json!({
        "schema": 1,
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        "representative_carts": cases.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        "cycles": cycles,
        "total_frames": total_frames,
        "elapsed_seconds": elapsed,
        "frames_per_second": fps,
        "sixty_hz_headroom": fps / 60.0,
        "start_peak_rss_bytes": start_rss,
        "peak_rss_bytes": peak,
        "growth_after_first_cycle_bytes": growth,
        "limits": {
            "max_rss_mib": max_rss_mib,
            "max_growth_mib": max_growth_mib,
            "min_frames_per_second": min_fps,
        },
        "checks": {"rss": rss_ok, "growth": growth_ok, "throughput": fps_ok},
        "cycle_samples": samples,
        "runs": runs,
        "pass": passed,
    });
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    std::fs::write(out, serde_json::to_string_pretty(&value).unwrap())
        .map_err(|e| format!("write {}: {e}", out.display()))?;
    eprintln!(
        "soak: {} frames in {:.3}s ({:.0} fps, {:.1}x 60 Hz), peak {:.1} MiB, growth {:.1} MiB",
        total_frames,
        elapsed,
        fps,
        fps / 60.0,
        mib(peak),
        growth as f64 / (1024.0 * 1024.0)
    );
    eprintln!("soak: report {}", out.display());
    Ok(passed)
}

#[cfg(test)]
mod tests {
    use super::CASES;

    #[test]
    fn representative_cases_are_public_release_carts() {
        assert_eq!(
            CASES,
            [
                ("horizon-burn", "horizon-burn"),
                ("wormtide", "wormtide"),
                ("seaway-dig", "seaway-dig"),
                ("micro-ai-war", "micro-ai-war"),
            ]
        );
    }
}
