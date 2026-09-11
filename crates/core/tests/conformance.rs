//! Core's own end-to-end smoke gate.
//!
//! Full suite grading (compare every cart to its blessed `[expected]`,
//! localize divergence, write blesses) is the **`calyx` CLI's** job —
//! `calyx verify` / `calyx bless`. This test keeps a
//! lightweight, dependency-free guarantee that `core` itself loads real
//! carts and runs them deterministically: it builds the conformance carts
//! with the suite's own `check.py build` and, if that toolchain is present,
//! runs a few of them twice and checks the runs are reproducible and clean.
//!
//! If `asc`/`node` aren't available, the carts can't be built and the test
//! skips — the 25 unit tests remain the hard gate; the full conformance
//! gate runs in CI via `calyx verify`.

use std::path::{Path, PathBuf};
use std::process::Command;

use calyx_core::{run, RunConfig};

fn conformance_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance")
        .canonicalize()
        .expect("conformance/ dir exists")
}

/// Build the carts with the suite's canonical builder. Returns false (skip)
/// if the toolchain isn't available.
fn try_build(conf: &Path) -> bool {
    match Command::new("python3")
        .arg("check.py")
        .arg("build")
        .current_dir(conf)
        .status()
    {
        Ok(s) if s.success() => true,
        _ => {
            eprintln!("SKIP smoke: could not build carts (need python3 + asc/node)");
            false
        }
    }
}

#[test]
fn core_runs_real_carts_deterministically() {
    let conf = conformance_dir();
    if !try_build(&conf) {
        return;
    }

    // (name, frames, expect-custom-palette)
    let cases = [
        ("checker", 30, false),
        ("particles", 120, false),
        ("av-events", 64, true),
    ];
    for (name, frames, custom_palette) in cases {
        let wasm = std::fs::read(conf.join("build").join(format!("{name}.wasm")))
            .unwrap_or_else(|e| panic!("read {name}.wasm: {e}"));
        let cfg = RunConfig::new(frames);

        let a = run(&wasm, &cfg, name).expect("run a");
        let b = run(&wasm, &cfg, name).expect("run b");

        assert!(a.fault.is_none(), "{name}: faulted {:?}", a.fault);
        assert_eq!(a.frames_run, frames, "{name}: short run");
        assert_eq!(a.run_hash, b.run_hash, "{name}: run is not deterministic");
        assert_eq!(
            a.final_hash, b.final_hash,
            "{name}: final not deterministic"
        );
        assert!(
            a.distinct_frame_hashes() > 1,
            "{name}: output never changed"
        );

        if custom_palette {
            assert!(
                a.palette_id.starts_with("custom:"),
                "{name}: expected a declared palette, got {}",
                a.palette_id
            );
        } else {
            assert_eq!(a.palette_id, "SWEETIE_16", "{name}: unexpected palette");
        }
        println!(
            "smoke {name}: run_hash {} ({} frames)",
            a.run_hex(),
            a.frames_run
        );
    }
}
