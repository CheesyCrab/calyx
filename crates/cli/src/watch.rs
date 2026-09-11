//! `calyx watch` — the editor-free inner loop.
//!
//! Not a file-watcher framework: just the cart loop. A [`Watcher`] polls
//! mtimes (250 ms, no dependencies) — when `--src` changes it runs the
//! `--build` command, and when the cart `.wasm` changes (however it got
//! rebuilt) the presenter swaps in a fresh [`Host`] and restarts from
//! frame 0. Restart-from-zero is the determinism story: a reloaded cart
//! replays exactly like a cold start, so headless verify sees the same
//! run the watcher showed you. Faults freeze the last verified frame and
//! wait for the next change; a failed build or load keeps the old cart.
//!
//! Status lines go to stderr (`watch: …`) so the terminal presenter's
//! stdout frames stay clean — and so the CLI regression test can drive a
//! reload headlessly.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use calyx_core::{Feed, FrameSink, Host};

use crate::present::{TerminalScale, TerminalSink};
use crate::timing::{PresentationRate, SimulationPacer};

/// Newest mtime under `path` (a file, or every file below a directory).
fn max_mtime(path: &Path) -> Option<SystemTime> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_file() {
        return meta.modified().ok();
    }
    let mut newest: Option<SystemTime> = None;
    let entries = std::fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        if let Some(t) = max_mtime(&entry.path()) {
            newest = Some(match newest {
                Some(n) if n >= t => n,
                _ => t,
            });
        }
    }
    newest
}

fn run_build(cmd: &str) -> bool {
    let status = if cfg!(windows) {
        std::process::Command::new("cmd").args(["/C", cmd]).status()
    } else {
        std::process::Command::new("sh").args(["-c", cmd]).status()
    };
    match status {
        Ok(s) if s.success() => true,
        Ok(s) => {
            eprintln!("watch: build failed ({s}) — keeping the old cart");
            false
        }
        Err(e) => {
            eprintln!("watch: build spawn failed: {e} — keeping the old cart");
            false
        }
    }
}

/// Polls the cart (and optional source) for changes; hands back fresh
/// wasm bytes when the presenter should reload.
pub struct Watcher {
    wasm_path: PathBuf,
    src: Option<PathBuf>,
    build: Option<String>,
    last_wasm: Option<SystemTime>,
    last_src: Option<SystemTime>,
    next_poll: Instant,
    pub reloads: u32,
}

const POLL_EVERY: Duration = Duration::from_millis(250);

impl Watcher {
    pub fn new(wasm_path: PathBuf, src: Option<PathBuf>, build: Option<String>) -> Watcher {
        let last_wasm = max_mtime(&wasm_path);
        let last_src = src.as_deref().and_then(max_mtime);
        Watcher {
            wasm_path,
            src,
            build,
            last_wasm,
            last_src,
            next_poll: Instant::now() + POLL_EVERY,
            reloads: 0,
        }
    }

    /// `Some(new wasm bytes)` when the cart changed on disk (rebuilding
    /// first if `--src` changed and a `--build` command is set).
    pub fn poll(&mut self) -> Option<Vec<u8>> {
        let now = Instant::now();
        if now < self.next_poll {
            return None;
        }
        self.next_poll = now + POLL_EVERY;

        if let Some(src) = &self.src {
            let t = max_mtime(src);
            if t != self.last_src {
                self.last_src = t;
                if let Some(cmd) = &self.build {
                    eprintln!("watch: source changed — building");
                    run_build(cmd);
                }
            }
        }

        let t = max_mtime(&self.wasm_path);
        if t != self.last_wasm {
            self.last_wasm = t;
            match std::fs::read(&self.wasm_path) {
                Ok(bytes) => {
                    self.reloads += 1;
                    eprintln!("watch: change detected — reloading");
                    return Some(bytes);
                }
                Err(e) => eprintln!("watch: read cart failed: {e}"),
            }
        }
        None
    }
}

/// Block until the watcher reports a change (the fault / load-error
/// parking loop).
fn wait_for_change(watcher: &mut Watcher) -> Vec<u8> {
    loop {
        if let Some(bytes) = watcher.poll() {
            return bytes;
        }
        std::thread::sleep(POLL_EVERY / 2);
    }
}

/// The terminal / headless watch loop: execute the cart at the ABI-pinned
/// 60 Hz simulation rate and optionally present at 30 or 60 Hz.
#[allow(clippy::too_many_arguments)]
pub fn watch_loop(
    mut wasm: Vec<u8>,
    cart_name: &str,
    w: i32,
    h: i32,
    presentation_rate: Option<PresentationRate>,
    feed: &Feed,
    mut watcher: Watcher,
    term: bool,
    term_scale: TerminalScale,
) -> Result<(), String> {
    loop {
        let mut host = match Host::new(&wasm, w, h) {
            Ok(host) => host,
            Err(e) => {
                eprintln!("watch: load error: {e} — waiting for change");
                wasm = wait_for_change(&mut watcher);
                continue;
            }
        };
        if let Err(fault) = host.start() {
            eprintln!(
                "watch: fault in start() ({}): {} — waiting for change",
                fault.kind, fault.msg
            );
            wasm = wait_for_change(&mut watcher);
            continue;
        }

        let mut term_sink = term.then(|| {
            TerminalSink::new(
                presentation_rate.expect("terminal watch requires a presentation rate"),
                term_scale,
            )
        });
        if let Some(sink) = &mut term_sink {
            sink.begin(w, h, host.palette_rgb());
        }
        eprintln!("watch: running {cart_name} (load #{})", watcher.reloads + 1);

        let mut pacer = SimulationPacer::new(Instant::now());
        'run: loop {
            if let Some(bytes) = watcher.poll() {
                wasm = bytes;
                break 'run;
            }
            let due = pacer.due(Instant::now());
            if due == 0 {
                std::thread::sleep(Duration::from_millis(2));
            }
            for _ in 0..due {
                let f = host.frames_run();
                match host.step(feed.at(f)) {
                    Ok(rec) => {
                        if let Some(sink) = &mut term_sink {
                            sink.frame(host.fb(), &rec);
                        }
                    }
                    Err(fault) => {
                        eprintln!(
                            "watch: fault at f{} ({}): {} — waiting for change",
                            fault.f, fault.kind, fault.msg
                        );
                        wasm = wait_for_change(&mut watcher);
                        break 'run;
                    }
                }
            }
        }
    }
}
