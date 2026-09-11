//! The conformance harness — `calyx verify` and `calyx bless`. The
//! grading rules are the conformance README's "How a runtime passes";
//! nothing here adds to the ABI.
//!
//! `core` is the runtime under test. The language-agnostic `check.py`
//! stays the way to grade runtimes over
//! the `status.json` dump; this is the native, first-divergence-localizing
//! path for the Rust runtime.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use calyx_core::{run, Feed, RunConfig, RunReport};
use serde_json::Value;
use toml_edit::{value, DocumentMut};

use crate::dump::frame_value;

/// The major ABI line this runtime implements. See docs/VERSIONING.md.
const RUNTIME_DIALECT: &str = "v1";

struct Manifest {
    name: String,
    abi: String,
    frames: i32,
    width: i32,
    height: i32,
    feed: Option<String>,
    min_distinct: usize,
    expected: Option<Expected>,
    /// A cart that is *expected to fault* (ABI §6a): `(frame, kind)`.
    /// Kind `"load"` means instantiation itself must fail (the §4b
    /// privilege gate) — `frame` is ignored.
    expected_fault: Option<(i32, String)>,
    /// A system cart: the runtime links `calyx.sys` (ABI §4b) and the
    /// feed's `carts` key supplies the scripted list.
    system: bool,
    dir: PathBuf,
}

struct Expected {
    run_hash: String,
    final_hash: String,
    palette: String,
    color: Option<String>,
}

fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let text = std::fs::read_to_string(dir.join("cart.toml"))
        .map_err(|e| format!("{}: {e}", dir.join("cart.toml").display()))?;
    let doc: DocumentMut = text.parse().map_err(|e| format!("parse cart.toml: {e}"))?;
    let s = |path: &[&str]| -> Option<String> {
        let mut node = doc.as_item();
        for k in path {
            node = node.get(k)?;
        }
        node.as_str().map(String::from)
    };
    let name = s(&["cart", "name"]).ok_or("cart.name missing")?;
    let abi = s(&["cart", "abi"]).unwrap_or_else(|| "v1".to_string());
    let frames = doc
        .get("run")
        .and_then(|r| r.get("frames"))
        .and_then(|v| v.as_integer())
        .ok_or("run.frames missing")? as i32;
    let feed = s(&["run", "feed"]);
    let width = doc
        .get("run")
        .and_then(|r| r.get("width"))
        .and_then(|v| v.as_integer())
        .unwrap_or(320) as i32;
    let height = doc
        .get("run")
        .and_then(|r| r.get("height"))
        .and_then(|v| v.as_integer())
        .unwrap_or(240) as i32;
    let min_distinct = doc
        .get("witness")
        .and_then(|w| w.get("min_distinct_frame_hashes"))
        .and_then(|v| v.as_integer())
        .unwrap_or(0) as usize;
    let expected = doc.get("expected").map(|e| Expected {
        color: e.get("color").and_then(|v| v.as_str()).map(String::from),
        run_hash: e
            .get("run_hash")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        final_hash: e
            .get("final_hash")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        palette: e
            .get("palette")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
    });
    let expected_fault = doc.get("fault").map(|f| {
        let frame = f.get("frame").and_then(|v| v.as_integer()).unwrap_or(0) as i32;
        let kind = f
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("trap")
            .to_string();
        (frame, kind)
    });
    let system = doc
        .get("cart")
        .and_then(|c| c.get("system"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok(Manifest {
        name,
        abi,
        frames,
        width,
        height,
        feed,
        min_distinct,
        expected,
        expected_fault,
        system,
        dir: dir.to_path_buf(),
    })
}

fn load_suite(suite: &Path) -> Result<Vec<Manifest>, String> {
    let carts = suite.join("carts");
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&carts)
        .map_err(|e| format!("read {}: {e}", carts.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("cart.toml").exists())
        .collect();
    dirs.sort();
    dirs.iter().map(|d| read_manifest(d)).collect()
}

fn newest_ts(root: &Path) -> Option<SystemTime> {
    if root.is_file() {
        return (root.extension().and_then(|e| e.to_str()) == Some("ts"))
            .then(|| std::fs::metadata(root).ok()?.modified().ok())
            .flatten();
    }
    let mut newest = None;
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        if let Some(t) = newest_ts(&entry.path()) {
            newest = Some(newest.map_or(t, |old: SystemTime| old.max(t)));
        }
    }
    newest
}

/// Rebuild missing or stale carts with the suite's canonical pinned builder.
/// Product fixtures may be thin wrappers, so the staleness frontier includes
/// fixture sources, product-cart sources, and Sunny rather than only entry.ts.
fn ensure_built(suite: &Path, manifests: &[Manifest], jobs: Option<u32>) -> Result<(), String> {
    let root = suite.parent().unwrap_or(suite);
    let newest_source = [
        suite.join("carts"),
        root.join("carts"),
        root.join("sdk").join("assembly"),
    ]
    .iter()
    .filter_map(|p| newest_ts(p))
    .max();
    let stale = manifests.iter().any(|m| {
        let wasm = suite.join("build").join(format!("{}.wasm", m.name));
        let Ok(built) = std::fs::metadata(wasm).and_then(|m| m.modified()) else {
            return true;
        };
        newest_source.is_some_and(|source| built < source)
    });
    if !stale {
        return Ok(());
    }
    let mut command = Command::new("python3");
    command.arg("check.py").arg("build");
    if let Some(jobs) = jobs {
        command.arg("--jobs").arg(jobs.to_string());
    }
    let status = command
        .current_dir(suite)
        .status()
        .map_err(|e| format!("run `python3 check.py build`: {e}"))?;
    if !status.success() {
        return Err(format!(
            "`check.py build` failed ({status}) — is `asc` installed?"
        ));
    }
    Ok(())
}

fn run_cart(suite: &Path, m: &Manifest) -> Result<RunReport, String> {
    let wasm = std::fs::read(suite.join("build").join(format!("{}.wasm", m.name)))
        .map_err(|e| format!("{}: {e}", m.name))?;
    let mut cfg = RunConfig::new(m.frames);
    cfg.w = m.width;
    cfg.h = m.height;
    cfg.system = m.system;
    if let Some(feed) = &m.feed {
        let text = std::fs::read_to_string(m.dir.join(feed))
            .map_err(|e| format!("read feed {feed}: {e}"))?;
        cfg.feed = Feed::from_json(&text).map_err(|e| format!("feed {feed}: {e}"))?;
        cfg.input_label = feed.clone();
    }
    run(&wasm, &cfg, &m.name).map_err(|e| format!("load {}: {e}", m.name))
}

/// The event map (frame → (audio, sys)) a run produced, for frames where
/// either stream is non-empty — the comparison shape for
/// `events.golden.jsonl`.
fn event_map(report: &RunReport) -> BTreeMap<i32, (Value, Value)> {
    let mut out = BTreeMap::new();
    for rec in &report.frames {
        if !rec.audio.is_empty() || !rec.sys.is_empty() {
            let row = frame_value(rec, report.system);
            let audio = row["audio"].clone();
            let sys = row.get("sys").cloned().unwrap_or(Value::Array(vec![]));
            out.insert(rec.f, (audio, sys));
        }
    }
    out
}

fn events_golden(dir: &Path) -> BTreeMap<i32, (Value, Value)> {
    let mut out = BTreeMap::new();
    let path = dir.join("events.golden.jsonl");
    if let Ok(text) = std::fs::read_to_string(path) {
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                if let Some(f) = v["f"].as_i64() {
                    let audio = v.get("audio").cloned().unwrap_or(Value::Array(vec![]));
                    let sys = v.get("sys").cloned().unwrap_or(Value::Array(vec![]));
                    out.insert(f as i32, (audio, sys));
                }
            }
        }
    }
    out
}

/// Grade one cart against its `[expected]`; returns the list of failures
/// (empty = pass).
fn grade(report: &RunReport, m: &Manifest, exp: &Expected) -> Vec<String> {
    let mut fails = Vec::new();
    if let Some(fault) = &report.fault {
        fails.push(format!(
            "run faulted at f{}: {} ({})",
            fault.f, fault.kind, fault.msg
        ));
    }
    if report.run_hex() != exp.run_hash {
        fails.push(format!(
            "run_hash: want {} got {}",
            exp.run_hash,
            report.run_hex()
        ));
    }
    if report.final_hex() != exp.final_hash {
        fails.push(format!(
            "final_hash: want {} got {}",
            exp.final_hash,
            report.final_hex()
        ));
    }
    if report.palette_id != exp.palette {
        fails.push(format!(
            "palette: want {} got {}",
            exp.palette, report.palette_id
        ));
    }
    let color = report.true_color.then_some("rgba8888");
    if color != exp.color.as_deref() {
        fails.push(format!("color: want {:?} got {:?}", exp.color, color));
    }
    let distinct = report.distinct_frame_hashes();
    if distinct < m.min_distinct {
        fails.push(format!(
            "vacuous golden: {distinct} distinct frame hashes < witness {}",
            m.min_distinct
        ));
    }
    let want = events_golden(&m.dir);
    if !want.is_empty() {
        let got = event_map(report);
        if got != want {
            fails.push("event stream mismatch (audio/sys)".to_string());
        }
    }
    fails
}

/// Best-effort: point at the first frame whose hash drifts from the
/// committed `frames.golden.jsonl`.
fn first_divergence(report: &RunReport, dir: &Path) {
    let path = dir.join("frames.golden.jsonl");
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let golden: Vec<&str> = text.lines().collect();
    for (rec, gline) in report.frames.iter().zip(golden) {
        let g: Value = match serde_json::from_str(gline) {
            Ok(v) => v,
            Err(_) => return,
        };
        let want = g["hash"].as_str().unwrap_or_default();
        let got = format!("{:016x}", rec.hash);
        if want != got {
            println!(
                "        first divergence at frame {}: want {want} got {got} trace={:?}",
                rec.f, rec.trace
            );
            return;
        }
    }
}

/// `calyx verify` — grade the whole suite. Returns true iff every gradable
/// cart passed and at least one was graded.
pub fn verify(suite: &Path, jobs: Option<u32>) -> Result<bool, String> {
    let manifests = load_suite(suite)?;
    ensure_built(suite, &manifests, jobs)?;

    let (mut passed, mut failed, mut skipped) = (0, 0, 0);
    for m in &manifests {
        if m.abi != RUNTIME_DIALECT {
            println!(
                "SKIP  {}: dialect {} != runtime's {RUNTIME_DIALECT}",
                m.name, m.abi
            );
            skipped += 1;
            continue;
        }
        // Carts expected to fault (ABI §6a) are graded on the fault record,
        // not a run_hash. Kind "load" is the §4b privilege gate: the cart
        // must fail at instantiation (it imports calyx.sys unprivileged).
        if let Some((frame, kind)) = &m.expected_fault {
            if kind == "load" {
                match run_cart(suite, m) {
                    Err(e) => {
                        println!("PASS  {}  refused to load (as expected: {e})", m.name);
                        passed += 1;
                    }
                    Ok(_) => {
                        println!("FAIL  {}", m.name);
                        println!("        expected a load error, cart instantiated fine");
                        failed += 1;
                    }
                }
                continue;
            }
            let report = run_cart(suite, m)?;
            match &report.fault {
                Some(f) if f.kind == *kind && f.f == *frame => {
                    println!(
                        "PASS  {}  faulted {} @f{} (as expected)",
                        m.name, f.kind, f.f
                    );
                    passed += 1;
                }
                Some(f) => {
                    println!("FAIL  {}", m.name);
                    println!(
                        "        want fault {kind} @f{frame}, got {} @f{}",
                        f.kind, f.f
                    );
                    failed += 1;
                }
                None => {
                    println!("FAIL  {}", m.name);
                    println!("        expected a {kind} fault @f{frame}, run completed clean");
                    failed += 1;
                }
            }
            continue;
        }

        let Some(exp) = &m.expected else {
            println!("SKIP  {}: pending bless (no [expected])", m.name);
            skipped += 1;
            continue;
        };
        let report = run_cart(suite, m)?;
        let fails = grade(&report, m, exp);
        if fails.is_empty() {
            println!(
                "PASS  {}  run_hash {} ({} frames)",
                m.name,
                report.run_hex(),
                report.frames_run
            );
            passed += 1;
        } else {
            println!("FAIL  {}", m.name);
            for f in &fails {
                println!("        {f}");
            }
            first_divergence(&report, &m.dir);
            failed += 1;
        }
    }

    println!("\ncore: {passed} pass, {failed} fail, {skipped} skip");
    Ok(failed == 0 && passed > 0)
}

/// `calyx bless` — (re)write `[expected]` + the diagnostic
/// `frames.golden.jsonl` for the named carts (all, if none named) from
/// this runtime's run. This is how new oracle hashes are minted.
pub fn bless(suite: &Path, names: &[String], jobs: Option<u32>) -> Result<(), String> {
    let manifests = load_suite(suite)?;
    ensure_built(suite, &manifests, jobs)?;

    for m in &manifests {
        if !names.is_empty() && !names.contains(&m.name) {
            continue;
        }
        if m.abi != RUNTIME_DIALECT {
            println!("skip {}: dialect {} != {RUNTIME_DIALECT}", m.name, m.abi);
            continue;
        }
        if m.expected_fault.is_some() {
            println!("skip {}: fault cart (no run_hash to bless)", m.name);
            continue;
        }
        let report = run_cart(suite, m)?;

        // [expected] block, formatting preserved.
        let path = m.dir.join("cart.toml");
        let text = std::fs::read_to_string(&path).map_err(|e| format!("{e}"))?;
        let mut doc: DocumentMut = text.parse().map_err(|e| format!("{e}"))?;
        let exp = doc.entry("expected").or_insert(toml_edit::table());
        let t = exp.as_table_mut().ok_or("[expected] is not a table")?;
        t.insert("run_hash", value(report.run_hex()));
        t.insert("final_hash", value(report.final_hex()));
        t.insert("palette", value(report.palette_id.clone()));
        if report.true_color {
            t.insert("color", value("rgba8888"));
        }
        t.insert("blessed_by", value("core"));
        std::fs::write(&path, doc.to_string()).map_err(|e| format!("{e}"))?;

        // frames.golden.jsonl — same serializer as `calyx run` (byte-identical).
        let mut golden = String::new();
        for rec in &report.frames {
            golden.push_str(&frame_value(rec, report.system).to_string());
            golden.push('\n');
        }
        std::fs::write(m.dir.join("frames.golden.jsonl"), golden).map_err(|e| format!("{e}"))?;

        println!(
            "bless {:<10} run={} final={} palette={} ({} frames)",
            m.name,
            report.run_hex(),
            report.final_hex(),
            report.palette_id,
            report.frames_run,
        );
    }
    Ok(())
}
