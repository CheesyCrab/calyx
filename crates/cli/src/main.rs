//! `calyx` — the native Calyx executable.
//!
//! Subcommands:
//!   * `run`    — load a cart, run it headless; dump (`status.json` +
//!     `frames.jsonl` + PNGs, ABI §6a) and/or present to the terminal,
//!     winit window, or portable SDL2.
//!   * `watch`  — the inner loop: run a cart and hot-reload it when it
//!     (or its source, via `--build`) changes on disk.
//!   * `verify` — grade the conformance suite against `core` (the gate).
//!   * `bless`  — (re)write `[expected]` + `frames.golden.jsonl` from a run.

#[cfg_attr(not(feature = "audio"), allow(dead_code))]
mod audio;
mod confirmation;
mod console;
mod dump;
#[cfg(feature = "sdl")]
mod perf_overlay;
mod present;
#[cfg(feature = "sdl")]
mod sdl;
mod soak;
mod suite;
mod term_console;
mod timing;
mod watch;
#[cfg(feature = "window")]
mod window;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use calyx_core::{run_with, Feed, FrameSink, NoSink, RunConfig};

use dump::PngSink;
use present::{TerminalScale, TerminalSink};
use timing::PresentationRate;

const PRODUCT_VERSION: &str = "1.0.0-rc.1";
const ABI_VERSION: &str = "v1.6";

fn main() -> ExitCode {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let product_options = args.is_empty()
        || matches!(
            args.first().map(String::as_str),
            Some("--audio" | "--fullscreen" | "--controller-db" | "--perf-log-dir")
        );
    if product_options {
        if let Some(mut product_args) = packaged_product_args() {
            product_args.extend(args);
            args = product_args;
        }
    }
    let cmd = args.first().map(String::as_str);
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };

    // `--help`/`-h` on a subcommand prints usage instead of tripping the
    // flag parser ("missing value for --help", T11.5 verifier F6).
    let help = rest.iter().any(|a| a == "--help" || a == "-h");
    let result = match cmd {
        Some("run" | "watch" | "console" | "bench-sdl" | "verify" | "bless" | "soak") if help => {
            print_usage();
            return ExitCode::SUCCESS;
        }
        Some("run") => cmd_run(rest),
        Some("watch") => cmd_watch(rest),
        Some("console") => cmd_console(rest),
        Some("bench-sdl") => cmd_bench_sdl(rest),
        Some("verify") => cmd_verify(rest),
        Some("bless") => cmd_bless(rest),
        Some("soak") => cmd_soak(rest),
        Some("-V") | Some("--version") => {
            println!("Calyx {PRODUCT_VERSION} · Calyx ABI {ABI_VERSION}");
            return ExitCode::SUCCESS;
        }
        Some("-h") | Some("--help") | Some("help") | None => {
            print_usage();
            return ExitCode::SUCCESS;
        }
        Some(other) => Err(format!("unknown command '{other}'\n\n{USAGE}")),
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// A packaged player is identified by an adjacent catalog. Its optional
/// descriptor supplies only the visible channel label; runtime and cart
/// behavior remain identical across package profiles.
fn packaged_product_args() -> Option<Vec<String>> {
    let executable = std::env::current_exe().ok()?;
    packaged_product_args_from(&executable)
}

fn packaged_product_root(executable: &Path) -> Option<PathBuf> {
    let adjacent = executable.parent()?;
    if adjacent.join("catalog").is_dir() {
        return Some(adjacent.to_path_buf());
    }
    if adjacent.file_name()? != "MacOS" {
        return None;
    }
    let contents = adjacent.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let resources = contents.join("Resources");
    resources.join("catalog").is_dir().then_some(resources)
}

fn packaged_product_args_from(executable: &Path) -> Option<Vec<String>> {
    let root = packaged_product_root(executable)?;
    let catalog = root.join("catalog");
    let label = std::fs::read_to_string(root.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|descriptor| descriptor["product"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "Calyx".to_string());
    let mut args = vec![
        "console".to_string(),
        "--carts".to_string(),
        catalog.to_string_lossy().into_owned(),
        "--present".to_string(),
        "sdl".to_string(),
        "--fullscreen".to_string(),
        "on".to_string(),
        "--product-label".to_string(),
        label,
    ];
    let mappings = root.join("gamecontrollerdb.txt");
    if mappings.is_file() {
        args.extend([
            "--controller-db".to_string(),
            mappings.to_string_lossy().into_owned(),
        ]);
    }
    Some(args)
}

const USAGE: &str = "\
usage:
  calyx --version
  calyx run   --cart <wasm> [--frames N] [--in <feed.json>] [--out <dir>]
              [--present headless|term|window|sdl] [--every N] [--fps N]
              [--width W] [--height H] [--term-scale auto|clean] [--audio on|off]
              [--fullscreen on|off] [--controller-db <gamecontrollerdb.txt>]
              [--perf-log-dir <directory>]
  calyx watch --cart <wasm> [--src <file-or-dir> --build \"<cmd>\"]
              [--present term|window|sdl|headless] [--in <feed.json>] [--fps N]
              [--width W] [--height H] [--term-scale auto|clean] [--audio on|off]
              [--fullscreen on|off] [--controller-db <gamecontrollerdb.txt>]
              [--perf-log-dir <directory>]
  calyx console --carts <dir> [--present window|sdl|headless|term] [--frames N]
              [--in <feed.json>] [--out <dir>] [--every N] [--fps N]
              [--width W] [--height H] [--term-scale auto|clean] [--audio on|off]
              [--fullscreen on|off] [--controller-db <gamecontrollerdb.txt>]
              [--perf-log-dir <directory>]
  calyx bench-sdl --cart <wasm> [--frames N] [--warmup N] [--in <feed.json>]
              [--width W] [--height H] [--out <report.json>]
  calyx verify [--suite <dir>] [--jobs N]
  calyx bless  [--suite <dir>] [--jobs N] [cart ...]
  calyx soak   [--suite <dir>] [--carts-root <dir>] [--cycles N]
               [--out <report.json>] [--max-rss-mib N]
               [--max-growth-mib N] [--min-fps N]

notes:
  --present window plays live until closed (keys: arrows/WASD, Z=A, X=B,
  Enter=Start, Backspace=launcher; Esc always quits); --frames/--out are ignored and a --in feed is
  OR-ed with the keyboard for deterministic replay. Simulation is fixed at
  60 Hz. --fps accepts 30 or 60 for presentation only; defaults are 30 for
  term and 60 for window/SDL. Headless modes reject --fps. Window audio
  defaults on; --audio off is silent.
  --present sdl is the portable fullscreen presenter: D-pad or left stick
  supplies directions, A/B/Start are cart buttons, controller Back/View
  returns home, and Guide/Home quits.
  It uses exact integer scaling with black letterbox; --fullscreen off is
  useful for desktop development. --controller-db loads extra SDL mappings.
  With the SDL performance panel visible, L+R then Y (Q+W then S) toggles a
  CSV capture in --perf-log-dir. CALYX_PERF_LOG_DIR supplies the packaged-player
  default. Turning the panel off stops an active capture.
  Terminal auto scale fits the live terminal and responds to resize;
  clean renders one column by two framebuffer pixels per terminal cell.
  watch reloads the cart when the .wasm changes; with --src/--build it
  first runs the build command when the source changes. Reload restarts
  from frame 0 (a reload replays exactly like a cold start).
  console --out (headless only) writes status.json + PNG sidecars of the
  active screen (final frame always, every Nth frame with --every) so
  the launcher render is verifiable without a window.
  bench-sdl runs the real indexed-to-ARGB and streaming-texture path uncapped
  through SDL's dummy software renderer. It is an A/B development facsimile,
  not a predictor of device FPS.";

fn print_usage() {
    println!("{USAGE}");
}

fn cmd_soak(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    let suite = PathBuf::from(f.get("suite").unwrap_or("conformance"));
    let carts = PathBuf::from(f.get("carts-root").unwrap_or("carts"));
    let out = PathBuf::from(f.get("out").unwrap_or("build/soak-report.json"));
    soak::run(
        &suite,
        &carts,
        f.int("cycles", 5)?.max(1) as u32,
        &out,
        f.int("max-rss-mib", 512)?.max(1) as u64,
        f.int("max-growth-mib", 64)?.max(0) as i64,
        f.int("min-fps", 300)?.max(1) as f64,
    )
}

// ── flag parsing ────────────────────────────────────────────────────────
struct Flags {
    map: std::collections::HashMap<String, String>,
    positional: Vec<String>,
}

impl Flags {
    /// Parse `--key value` pairs and bare positionals. Flags named in
    /// `BOOL_FLAGS` take no value.
    fn parse(args: &[String]) -> Result<Flags, String> {
        const BOOL_FLAGS: [&str; 1] = ["system"];
        let mut map = std::collections::HashMap::new();
        let mut positional = Vec::new();
        let mut i = 0;
        while i < args.len() {
            let a = &args[i];
            if let Some(key) = a.strip_prefix("--") {
                if BOOL_FLAGS.contains(&key) {
                    map.insert(key.to_string(), "true".to_string());
                    i += 1;
                    continue;
                }
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| format!("missing value for --{key}"))?;
                map.insert(key.to_string(), val.clone());
                i += 2;
            } else {
                positional.push(a.clone());
                i += 1;
            }
        }
        Ok(Flags { map, positional })
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.map.get(key).map(String::as_str)
    }
    fn int(&self, key: &str, default: i32) -> Result<i32, String> {
        match self.get(key) {
            Some(v) => v
                .parse()
                .map_err(|_| format!("--{key} expects an integer, got '{v}'")),
            None => Ok(default),
        }
    }

    #[cfg(any(feature = "window", feature = "sdl"))]
    fn audio(&self) -> Result<bool, String> {
        self.on_off("audio", true)
    }

    #[cfg(any(feature = "window", feature = "sdl"))]
    fn on_off(&self, key: &str, default: bool) -> Result<bool, String> {
        let default = if default { "on" } else { "off" };
        match self.get(key).unwrap_or(default) {
            "on" => Ok(true),
            "off" => Ok(false),
            value => Err(format!("--{key} must be on|off, got '{value}'")),
        }
    }
}

fn presentation_rate(f: &Flags, default: i32) -> Result<PresentationRate, String> {
    PresentationRate::parse(f.int("fps", default)?)
}

fn presentation_override(f: &Flags) -> Result<Option<PresentationRate>, String> {
    f.get("fps")
        .map(|raw| {
            raw.parse::<i32>()
                .map_err(|_| format!("--fps expects an integer, got '{raw}'"))
                .and_then(PresentationRate::parse)
        })
        .transpose()
}

fn reject_headless_fps(f: &Flags) -> Result<(), String> {
    if f.get("fps").is_some() {
        return Err(
            "--fps controls presentation cadence and is invalid with --present headless"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(feature = "sdl")]
fn perf_log_dir(f: &Flags) -> Option<PathBuf> {
    f.get("perf-log-dir").map(PathBuf::from).or_else(|| {
        std::env::var_os("CALYX_PERF_LOG_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    })
}

fn cmd_bench_sdl(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    let cart = f
        .get("cart")
        .ok_or("bench-sdl: --cart <wasm> is required")?;
    let frames = f.int("frames", 600)?;
    let warmup = f.int("warmup", 120)?;
    let width = f.int("width", 1280)?;
    let height = f.int("height", 720)?;
    if frames < 1 {
        return Err("bench-sdl: --frames must be at least 1".to_string());
    }
    if warmup < 0 {
        return Err("bench-sdl: --warmup cannot be negative".to_string());
    }
    if width < 1 || height < 1 {
        return Err("bench-sdl: dimensions must be positive".to_string());
    }
    let wasm = std::fs::read(cart).map_err(|e| format!("read cart {cart}: {e}"))?;
    let cart_name = PathBuf::from(cart)
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "cart".to_string());
    let feed = if let Some(path) = f.get("in") {
        let text = std::fs::read_to_string(path).map_err(|e| format!("read feed {path}: {e}"))?;
        Feed::from_json(&text).map_err(|e| format!("feed {path}: {e}"))?
    } else {
        Feed::empty()
    };
    #[cfg(feature = "sdl")]
    return sdl::benchmark(
        &wasm,
        &cart_name,
        width,
        height,
        warmup as u32,
        frames as u32,
        feed,
        f.get("out").map(Path::new),
    );
    #[cfg(not(feature = "sdl"))]
    {
        let _ = (wasm, cart_name, feed);
        Err("this calyx was built without the `sdl` feature".to_string())
    }
}

// ── run ─────────────────────────────────────────────────────────────────
fn cmd_run(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    let cart = f.get("cart").ok_or("run: --cart <wasm> is required")?;
    let frames = f.int("frames", 30)?;
    let width = f.int("width", 320)?;
    let height = f.int("height", 240)?;
    let every = f.int("every", 0)?;
    let present = f.get("present").unwrap_or("headless");
    let out = f.get("out").map(PathBuf::from);

    let wasm = std::fs::read(cart).map_err(|e| format!("read cart {cart}: {e}"))?;
    let cart_name = PathBuf::from(cart)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "cart".to_string());

    let mut feed = Feed::empty();
    let mut input_label = "(none)".to_string();
    if let Some(path) = f.get("in") {
        let text = std::fs::read_to_string(path).map_err(|e| format!("read feed {path}: {e}"))?;
        feed = Feed::from_json(&text).map_err(|e| format!("feed {path}: {e}"))?;
        input_label = path.to_string();
    }

    // The window presenter is a live loop, not a bounded headless run —
    // it drives the same stepping Host, so it can't drift from what
    // verification measures.
    if present == "window" {
        #[cfg(feature = "window")]
        {
            let rate = presentation_rate(&f, 60)?;
            return window::play(
                &wasm,
                &cart_name,
                width,
                height,
                rate,
                feed,
                None,
                f.audio()?,
            );
        }
        #[cfg(not(feature = "window"))]
        return Err("this calyx was built without the `window` feature \
             (rebuild with default features)"
            .to_string());
    }

    if present == "sdl" {
        #[cfg(feature = "sdl")]
        {
            let rate = presentation_rate(&f, 60)?;
            return sdl::play(
                &wasm,
                &cart_name,
                width,
                height,
                rate,
                feed,
                None,
                f.audio()?,
                f.on_off("fullscreen", true)?,
                f.get("controller-db").map(PathBuf::from),
                perf_log_dir(&f),
            );
        }
        #[cfg(not(feature = "sdl"))]
        return Err("this calyx was built without the `sdl` feature".to_string());
    }

    let mut cfg = RunConfig::new(frames);
    cfg.w = width;
    cfg.h = height;
    cfg.feed = feed;
    cfg.input_label = input_label;
    cfg.system = f.get("system").is_some();

    // Pick the presenter sink for this run.
    let mut term;
    let mut png;
    let mut nosink = NoSink;
    let sink: &mut dyn FrameSink = match present {
        "term" => {
            term = TerminalSink::new(
                presentation_rate(&f, 30)?,
                TerminalScale::parse(f.get("term-scale"))?,
            );
            &mut term
        }
        "headless" => match &out {
            Some(dir) => {
                reject_headless_fps(&f)?;
                png = PngSink::new(dir.clone(), every, frames);
                &mut png
            }
            None => {
                reject_headless_fps(&f)?;
                &mut nosink
            }
        },
        other => {
            return Err(format!(
                "--present must be headless|term|window|sdl, got '{other}'"
            ))
        }
    };

    let report = run_with(&wasm, &cfg, &cart_name, sink).map_err(|e| format!("{e}"))?;

    if let Some(dir) = &out {
        dump::write_status_and_frames(&report, dir)
            .map_err(|e| format!("write dump to {}: {e}", dir.display()))?;
    }

    match &report.fault {
        Some(fault) => println!(
            "ran {} frames → faulted at f{} ({}: {})",
            report.frames_run, fault.f, fault.kind, fault.msg
        ),
        None => {
            let where_to = out.as_ref().map(|d| d.display().to_string());
            match where_to {
                Some(d) => println!(
                    "ran {} frames → {d} (run_hash {})",
                    report.frames_run,
                    report.run_hex()
                ),
                None => println!(
                    "ran {} frames (run_hash {})",
                    report.frames_run,
                    report.run_hex()
                ),
            }
        }
    }
    Ok(true)
}

// ── watch ───────────────────────────────────────────────────────────────
fn cmd_watch(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    let cart = f.get("cart").ok_or("watch: --cart <wasm> is required")?;
    let width = f.int("width", 320)?;
    let height = f.int("height", 240)?;
    let present = f.get("present").unwrap_or("term");
    let src = f.get("src").map(PathBuf::from);
    let build = f.get("build").map(String::from);
    if build.is_some() && src.is_none() {
        return Err("watch: --build needs --src <file-or-dir> to trigger it".to_string());
    }

    let mut feed = Feed::empty();
    if let Some(path) = f.get("in") {
        let text = std::fs::read_to_string(path).map_err(|e| format!("read feed {path}: {e}"))?;
        feed = Feed::from_json(&text).map_err(|e| format!("feed {path}: {e}"))?;
    }

    let wasm_path = PathBuf::from(cart);
    let wasm = std::fs::read(&wasm_path).map_err(|e| format!("read cart {cart}: {e}"))?;
    let cart_name = wasm_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "cart".to_string());
    let watcher = watch::Watcher::new(wasm_path, src, build);

    match present {
        "window" => {
            #[cfg(feature = "window")]
            {
                let rate = presentation_rate(&f, 60)?;
                window::play(
                    &wasm,
                    &cart_name,
                    width,
                    height,
                    rate,
                    feed,
                    Some(watcher),
                    f.audio()?,
                )
            }
            #[cfg(not(feature = "window"))]
            Err("this calyx was built without the `window` feature \
                 (rebuild with default features)"
                .to_string())
        }
        "sdl" => {
            #[cfg(feature = "sdl")]
            {
                let rate = presentation_rate(&f, 60)?;
                sdl::play(
                    &wasm,
                    &cart_name,
                    width,
                    height,
                    rate,
                    feed,
                    Some(watcher),
                    f.audio()?,
                    f.on_off("fullscreen", true)?,
                    f.get("controller-db").map(PathBuf::from),
                    perf_log_dir(&f),
                )
            }
            #[cfg(not(feature = "sdl"))]
            Err("this calyx was built without the `sdl` feature".to_string())
        }
        "term" => {
            let rate = presentation_rate(&f, 30)?;
            let term_scale = TerminalScale::parse(f.get("term-scale"))?;
            watch::watch_loop(
                wasm,
                &cart_name,
                width,
                height,
                Some(rate),
                &feed,
                watcher,
                true,
                term_scale,
            )?;
            Ok(true)
        }
        "headless" => {
            reject_headless_fps(&f)?;
            watch::watch_loop(
                wasm,
                &cart_name,
                width,
                height,
                None,
                &feed,
                watcher,
                false,
                TerminalScale::Auto,
            )?;
            Ok(true)
        }
        other => Err(format!(
            "--present must be term|window|sdl|headless, got '{other}'"
        )),
    }
}

// ── console ─────────────────────────────────────────────────────────────
fn cmd_console(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    let dir = PathBuf::from(f.get("carts").ok_or("console: --carts <dir> is required")?);
    let width = f.int("width", 320)?;
    let height = f.int("height", 240)?;
    let present = f.get("present").unwrap_or("window");

    match present {
        "window" => {
            #[cfg(feature = "window")]
            {
                let rate = presentation_override(&f)?;
                window::play_console(&dir, width, height, rate, f.audio()?)
            }
            #[cfg(not(feature = "window"))]
            Err("this calyx was built without the `window` feature \
                 (rebuild with default features)"
                .to_string())
        }
        "sdl" => {
            #[cfg(feature = "sdl")]
            {
                let rate = presentation_override(&f)?;
                sdl::play_console(
                    &dir,
                    width,
                    height,
                    rate,
                    f.audio()?,
                    f.on_off("fullscreen", true)?,
                    f.get("controller-db").map(PathBuf::from),
                    f.get("product-label").unwrap_or("Calyx"),
                    perf_log_dir(&f),
                )
            }
            #[cfg(not(feature = "sdl"))]
            Err("this calyx was built without the `sdl` feature".to_string())
        }
        "term" => {
            // The interactive SSH launcher loop — a live presenter, not
            // the verifiable scripted loop. `--in`, when given, is OR-ed
            // with the keyboard (deterministic replay with live override,
            // same as `run --present window`).
            let rate = presentation_rate(&f, 30)?;
            let mut feed = Feed::empty();
            if let Some(path) = f.get("in") {
                let text =
                    std::fs::read_to_string(path).map_err(|e| format!("read feed {path}: {e}"))?;
                feed = Feed::from_json(&text).map_err(|e| format!("feed {path}: {e}"))?;
            }
            let term_scale = TerminalScale::parse(f.get("term-scale"))?;
            term_console::play_console(&dir, width, height, rate, feed, term_scale)
        }
        "headless" => {
            // The scripted chainload loop — the T10 gate's verifiable leg:
            // the feed drives whichever cart is active, local frame 0 on
            // every swap.
            reject_headless_fps(&f)?;
            let frames = f.int("frames", 600)?.max(0);
            let every = f.int("every", 0)?;
            let out = f.get("out").map(PathBuf::from);
            let mut feed = Feed::empty();
            if let Some(path) = f.get("in") {
                let text =
                    std::fs::read_to_string(path).map_err(|e| format!("read feed {path}: {e}"))?;
                feed = Feed::from_json(&text).map_err(|e| format!("feed {path}: {e}"))?;
            }
            console::run_headless(&dir, &feed, frames, width, height, out.as_deref(), every)?;
            Ok(true)
        }
        other => Err(format!(
            "--present must be window|sdl|headless|term, got '{other}'"
        )),
    }
}

// ── verify / bless ────────────────────────────────────────────────────────
fn suite_dir(f: &Flags) -> PathBuf {
    PathBuf::from(f.get("suite").unwrap_or("conformance"))
}

fn build_jobs(f: &Flags) -> Result<Option<u32>, String> {
    let Some(raw) = f.get("jobs") else {
        return Ok(None);
    };
    let jobs: u32 = raw
        .parse()
        .map_err(|_| format!("--jobs expects a positive integer, got '{raw}'"))?;
    if jobs == 0 {
        return Err("--jobs must be at least 1".to_string());
    }
    Ok(Some(jobs))
}

fn cmd_verify(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    suite::verify(&suite_dir(&f), build_jobs(&f)?)
}

fn cmd_bless(args: &[String]) -> Result<bool, String> {
    let f = Flags::parse(args)?;
    suite::bless(&suite_dir(&f), &f.positional, build_jobs(&f)?)?;
    Ok(true)
}

#[cfg(test)]
mod packaged_product_tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("calyx-package-root-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn packaged_product_root_finds_macos_resources() {
        let root = root("macos");
        let executable = root.join("Calyx.app/Contents/MacOS/calyx");
        std::fs::create_dir_all(root.join("Calyx.app/Contents/Resources/catalog")).unwrap();
        assert_eq!(
            packaged_product_root(&executable),
            Some(root.join("Calyx.app/Contents/Resources"))
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn packaged_product_root_prefers_adjacent_catalog() {
        let root = root("adjacent");
        let executable = root.join("calyx.exe");
        std::fs::create_dir_all(root.join("catalog")).unwrap();
        assert_eq!(packaged_product_root(&executable), Some(root.clone()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn packaged_product_args_read_descriptor_and_controller_db_from_root() {
        let root = root("args");
        let executable = root.join("Calyx.app/Contents/MacOS/calyx");
        let resources = root.join("Calyx.app/Contents/Resources");
        std::fs::create_dir_all(resources.join("catalog")).unwrap();
        std::fs::write(
            resources.join("package.json"),
            r#"{"product":"Calyx Side B"}"#,
        )
        .unwrap();
        std::fs::write(resources.join("gamecontrollerdb.txt"), "mapping").unwrap();
        let args = packaged_product_args_from(&executable).unwrap();
        assert_eq!(args[0], "console");
        assert_eq!(args[2], resources.join("catalog").to_string_lossy());
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--product-label", "Calyx Side B"]));
        assert!(args.windows(2).any(|pair| pair[0] == "--controller-db"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
