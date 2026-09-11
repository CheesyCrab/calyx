//! CLI regression tests for the `calyx` binary.
//!
//! Two guarantees that were previously only checked by hand:
//!   1. `calyx run`'s headless dump is byte-identical to the oracle — the
//!      `status.json` run_hash matches `[expected]` and `frames.jsonl`
//!      reproduces the committed golden exactly.
//!   2. `calyx verify` actually *fails* on a planted bad hash (a grader that
//!      always passes is the classic silent bug).
//!
//! Both build the carts with the suite's `check.py build`; if that toolchain
//! is absent the tests skip (the unit suite stays the hard gate).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

fn calyx_bin() -> &'static str {
    env!("CARGO_BIN_EXE_calyx")
}

fn conformance() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance")
        .canonicalize()
        .expect("conformance/ exists")
}

fn tmp(name: &str) -> PathBuf {
    let p = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&p);
    p
}

/// Build the carts; returns false (skip) if the toolchain is unavailable.
fn ensure_built(conf: &Path) -> bool {
    static BUILT: OnceLock<bool> = OnceLock::new();
    *BUILT.get_or_init(|| {
        Command::new("python3")
            .arg("check.py")
            .arg("build")
            .current_dir(conf)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

fn toml_field(toml: &str, key: &str) -> String {
    for line in toml.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            if let Some(eq) = rest.trim_start().strip_prefix('=') {
                return eq.trim().trim_matches('"').to_string();
            }
        }
    }
    panic!("key {key} not found in cart.toml");
}

#[test]
fn subcommand_help_prints_usage_not_an_error() {
    // T11.5 verifier F6: `calyx run --help` used to die with
    // "missing value for --help". Every subcommand must print usage.
    for cmd in [
        "run",
        "watch",
        "console",
        "bench-sdl",
        "verify",
        "bless",
        "soak",
    ] {
        for flag in ["--help", "-h"] {
            let out = Command::new(calyx_bin())
                .args([cmd, flag])
                .output()
                .expect("spawn calyx");
            assert!(out.status.success(), "calyx {cmd} {flag} exited nonzero");
            let stdout = String::from_utf8_lossy(&out.stdout);
            assert!(
                stdout.contains("usage:"),
                "calyx {cmd} {flag} printed no usage: {stdout}"
            );
        }
    }
}

#[cfg(feature = "sdl")]
#[test]
fn sdl_benchmark_runs_the_dummy_streaming_texture_path() {
    let conf = conformance();
    if !ensure_built(&conf) {
        eprintln!("SKIP: cart toolchain unavailable");
        return;
    }
    let report = tmp("sdl-benchmark").join("report.json");
    let output = Command::new(calyx_bin())
        .args(["bench-sdl", "--cart"])
        .arg(conf.join("build/hd-input.wasm"))
        .args([
            "--warmup", "1", "--frames", "2", "--width", "1280", "--height", "720", "--out",
        ])
        .arg(&report)
        .output()
        .expect("spawn calyx bench-sdl");
    assert!(
        output.status.success(),
        "bench-sdl failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(report).unwrap()).unwrap();
    assert_eq!(report["kind"], "calyx-sdl-headless-benchmark");
    assert_eq!(report["video_driver"], "dummy");
    assert_eq!(report["renderer"], "software");
    assert_eq!(report["measured_frames"], 2);
    assert_eq!(report["width"], 1280);
    assert_eq!(report["height"], 720);
    assert_eq!(report["sim"].as_object().unwrap().len(), 3);
    assert_eq!(report["rgb"].as_object().unwrap().len(), 3);
    assert_eq!(report["sdl"].as_object().unwrap().len(), 3);
}

#[test]
fn version_reports_product_and_abi_layers() {
    let out = Command::new(calyx_bin())
        .arg("--version")
        .output()
        .expect("spawn calyx");
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "Calyx 1.0.0-rc.1 · Calyx ABI v1.6\n"
    );
}

#[test]
fn fps_is_strictly_presentation_cadence() {
    // Rate validation happens before instantiation, so a tracked readable file
    // is sufficient and keeps this regression independent of generated carts.
    let cart = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let headless = Command::new(calyx_bin())
        .args(["run", "--cart"])
        .arg(&cart)
        .args(["--present", "headless", "--fps", "30"])
        .output()
        .expect("spawn headless calyx");
    assert!(!headless.status.success());
    assert!(String::from_utf8_lossy(&headless.stderr).contains("invalid with --present headless"));

    let high_refresh = Command::new(calyx_bin())
        .args(["run", "--cart"])
        .arg(&cart)
        .args(["--present", "term", "--fps", "120"])
        .output()
        .expect("spawn terminal calyx");
    assert!(!high_refresh.status.success());
    assert!(String::from_utf8_lossy(&high_refresh.stderr).contains("must be 30 or 60"));
}

#[test]
fn run_dump_is_byte_identical_to_the_oracle() {
    let conf = conformance();
    if !ensure_built(&conf) {
        eprintln!("SKIP: cart toolchain unavailable");
        return;
    }
    let out = tmp("checker-run");
    let checker = conf.join("carts/checker");

    let status = Command::new(calyx_bin())
        .args(["run", "--cart"])
        .arg(conf.join("build/checker.wasm"))
        .args(["--frames", "30", "--in"])
        .arg(checker.join("checker.in.json"))
        .arg("--out")
        .arg(&out)
        .status()
        .expect("spawn calyx run");
    assert!(status.success(), "calyx run failed");

    // status.json run_hash == the cart's blessed [expected].run_hash
    let dumped: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("status.json")).unwrap()).unwrap();
    let manifest = std::fs::read_to_string(checker.join("cart.toml")).unwrap();
    assert_eq!(
        dumped["run_hash"].as_str().unwrap(),
        toml_field(&manifest, "run_hash"),
        "status.json run_hash drifted from the oracle",
    );
    assert!(dumped.get("fault").is_none(), "unexpected fault in dump");

    // frames.jsonl reproduces the committed golden, byte-for-byte.
    let got = std::fs::read(out.join("frames.jsonl")).unwrap();
    let want = std::fs::read(checker.join("frames.golden.jsonl")).unwrap();
    assert_eq!(got, want, "frames.jsonl drifted from frames.golden.jsonl");
}

#[test]
fn verify_fails_on_a_planted_mismatch() {
    let conf = conformance();
    if !ensure_built(&conf) {
        eprintln!("SKIP: cart toolchain unavailable");
        return;
    }
    // A one-cart suite that reuses the real checker wasm but corrupts its
    // expected run_hash — verify must catch it.
    let suite = tmp("bad-suite");
    let cart = suite.join("carts/checker");
    std::fs::create_dir_all(&cart).unwrap();
    std::fs::create_dir_all(suite.join("build")).unwrap();
    std::fs::copy(
        conf.join("build/checker.wasm"),
        suite.join("build/checker.wasm"),
    )
    .unwrap();
    std::fs::copy(
        conf.join("carts/checker/checker.in.json"),
        cart.join("checker.in.json"),
    )
    .unwrap();

    let manifest = std::fs::read_to_string(conf.join("carts/checker/cart.toml")).unwrap();
    let real = toml_field(&manifest, "run_hash");
    let corrupted = manifest.replace(&real, "0000000000000000");
    assert_ne!(corrupted, manifest, "failed to corrupt the run_hash");
    std::fs::write(cart.join("cart.toml"), corrupted).unwrap();

    let status = Command::new(calyx_bin())
        .args(["verify", "--suite"])
        .arg(&suite)
        .status()
        .expect("spawn calyx verify");
    assert!(
        !status.success(),
        "verify passed a planted mismatch — the gate is hollow"
    );
}

#[test]
fn watch_reloads_when_the_cart_changes() {
    use std::io::BufRead;
    use std::sync::mpsc;
    use std::time::Duration;

    let conf = conformance();
    if !ensure_built(&conf) {
        eprintln!("SKIP: cart toolchain unavailable");
        return;
    }
    let dir = tmp("watch-reload");
    std::fs::create_dir_all(&dir).unwrap();
    let cart = dir.join("cart.wasm");
    std::fs::copy(conf.join("build/checker.wasm"), &cart).unwrap();

    let mut child = Command::new(calyx_bin())
        .args(["watch", "--cart"])
        .arg(&cart)
        .args(["--present", "headless"])
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn calyx watch");

    // Stream stderr lines to a channel so waits can time out.
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
        {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let wait_for = |needle: &str| loop {
        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(line) if line.contains(needle) => break,
            Ok(_) => continue,
            Err(_) => panic!("timed out waiting for '{needle}' on watch stderr"),
        }
    };

    wait_for("watch: running cart (load #1)");
    // Let the mtime tick past coarse-granularity filesystems, then swap
    // in a different cart.
    std::thread::sleep(Duration::from_millis(1100));
    std::fs::copy(conf.join("build/particles.wasm"), &cart).unwrap();
    wait_for("watch: change detected — reloading");
    wait_for("watch: running cart (load #2)");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn console_chainloads_launch_and_exit() {
    use std::io::BufRead;
    use std::sync::mpsc;
    use std::time::Duration;

    let conf = conformance();
    if !ensure_built(&conf) {
        eprintln!("SKIP: cart toolchain unavailable");
        return;
    }
    // A console dir: launcher + a normal cart + the settings system cart.
    let dir = tmp("console-dir");
    for (name, manifest) in [
        ("launcher", "[cart]\nname = \"launcher\"\nsystem = true\n"),
        (
            "checker",
            "[cart]\nname = \"checker\"\nauthor = \"Cheesy Crab\"\nversion = \"0.1.0\"\ncategory = \"Games\"\n",
        ),
        (
            "settings",
            "[cart]\nname = \"settings\"\nauthor = \"Cheesy Crab\"\nversion = \"1.0.0\"\ncategory = \"Settings\"\nsystem = true\n",
        ),
    ] {
        let sub = dir.join(name);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::copy(conf.join(format!("build/{name}.wasm")), sub.join("cart.wasm")).unwrap();
        std::fs::write(sub.join("cart.toml"), manifest).unwrap();
    }
    // The feed drives whichever cart is active, from local frame 0:
    // launcher — RIGHT@4 (select Settings category), A@8 (launch);
    // settings — START@20 (sys_exit → launcher). Ping-pong until the cap.
    let feed = dir.join("feed.json");
    std::fs::write(
        &feed,
        r#"[{"f":4,"hold":["RIGHT"]},{"f":5,"hold":[]},{"f":8,"hold":["A"]},
           {"f":9,"hold":[]},{"f":20,"hold":["START"]},{"f":21,"hold":[]}]"#,
    )
    .unwrap();

    let out = tmp("console-dump");
    let mut child = Command::new(calyx_bin())
        .args(["console", "--carts"])
        .arg(&dir)
        .args(["--present", "headless", "--frames", "120", "--in"])
        .arg(&feed)
        .arg("--out")
        .arg(&out)
        .args(["--every", "40"])
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn calyx console");

    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
        {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let wait_for = |needle: &str| loop {
        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(line) if line.contains(needle) => break,
            Ok(_) => continue,
            Err(_) => panic!("timed out waiting for '{needle}' on console stderr"),
        }
    };

    // Boot-to-launcher → pick cart → play → sys_exit back (the T10 gate).
    wait_for("console: booted launcher (2 carts)");
    wait_for("console: launch 1 -> settings");
    wait_for("console: exit -> launcher");
    wait_for("console: launch 1 -> settings"); // and around again

    let status = child.wait().expect("console exits");
    assert!(status.success(), "console run failed");

    // The --out dump: PNG sidecars of the active screen (every 40th
    // frame + the final frame) and a status.json a CI gate can read.
    for f in ["frame_0000.png", "frame_0040.png", "frame_0119.png"] {
        assert!(out.join(f).exists(), "missing console dump sidecar {f}");
    }
    let status: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("status.json")).unwrap()).unwrap();
    assert_eq!(status["mode"], "console");
    assert_eq!(status["frames_run"], 120);
    assert_eq!(status["initial_role"], "launcher");
    assert_eq!(status["final_role"], "launcher");
    assert!(
        status["swaps"].as_u64().unwrap() >= 3,
        "expected the launch/exit ping-pong in status.json, got {status}"
    );
}

#[test]
fn console_error_names_the_cart_and_exits_nonzero() {
    // T11.5 console F5: a cart that fails to load must name itself in
    // the error and the process must exit nonzero for CI gates.
    let conf = conformance();
    if !ensure_built(&conf) {
        eprintln!("SKIP: cart toolchain unavailable");
        return;
    }
    let dir = tmp("console-broken");
    for (name, manifest) in [
        ("launcher", "[cart]\nname = \"launcher\"\nsystem = true\n"),
        (
            "checker",
            "[cart]\nname = \"checker\"\nauthor = \"Cheesy Crab\"\nversion = \"0.1.0\"\n",
        ),
    ] {
        let sub = dir.join(name);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::copy(
            conf.join(format!("build/{name}.wasm")),
            sub.join("cart.wasm"),
        )
        .unwrap();
        std::fs::write(sub.join("cart.toml"), manifest).unwrap();
    }
    // Corrupt the installed cart, then have the feed launch it (A@8
    // launches index 0 = checker, the only installed cart).
    std::fs::write(dir.join("checker/cart.wasm"), b"not a wasm module").unwrap();
    let feed = dir.join("feed.json");
    std::fs::write(&feed, r#"[{"f":8,"hold":["A"]},{"f":9,"hold":[]}]"#).unwrap();

    let out = Command::new(calyx_bin())
        .args(["console", "--carts"])
        .arg(&dir)
        .args(["--present", "headless", "--frames", "60", "--in"])
        .arg(&feed)
        .output()
        .expect("spawn calyx console");
    assert!(
        !out.status.success(),
        "console exited 0 despite a broken cart"
    );
    // The *error line* must name the cart — "console: launch 0 -> checker"
    // predates the fix and would make a bare contains("checker") pass
    // against the old nameless error message.
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("load checker:"),
        "error line does not name the failing cart: {stderr}"
    );
}
