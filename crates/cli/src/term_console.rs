//! `calyx console --present term` — the SSH-friendly launcher loop.
//!
//! A third console presenter alongside `window::play_console` (glass) and
//! `console::run_headless` (the verifiable scripted loop). This one is the
//! interactive terminal: the same boot→launch→play→exit flow, rendered via
//! [`TerminalSink`] (half-block ANSI on the verified framebuffer) and driven
//! by live stdin keys through `crossterm` raw mode.
//!
//! Like every presenter this is an **unverified** sink (README, "Scope
//! frontiers"); nothing here changes what a run hashes. It reuses the
//! verified pieces — [`console::scan_carts`], [`console::action_of`], the
//! [`Host`] the verifier drives — and mirrors `window::play_console`'s
//! swap/Esc semantics so the two presenters feel like one console:
//!
//!   * Backspace in a game returns to the launcher; Esc always quits.
//!   * Ctrl-C quits from anywhere.
//!   * A failed mid-session boot stays put and flags the session errored
//!     (nonzero exit, the T11.5 F5/F6 contract).
//!   * A fault ends the session (the term loop has no "wait for change"
//!     trigger the way `watch` does; a clean exit beats a frozen screen
//!     over SSH).

use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

use calyx_core::{Feed, FrameSink, Host};

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::terminal;

use crate::console::{
    action_of, scan_carts, ConsoleCart, ConsoleScreen, DisplayProfile, SysAction,
};
use crate::present::{TerminalScale, TerminalSink};
use crate::timing::{PresentationRate, SimulationPacer};

/// `crossterm` `KeyCode` → btn bit, mirroring [`crate::window::key_bit`]
/// and the web shell's `KEY_TO_BIT` (`web/src/canvas.mjs`):
/// arrows/WASD, Z=A, X=B, Enter=Start. Esc and Ctrl-C are handled by the
/// caller (launcher-quit / game→launcher / force-quit), not here.
pub fn key_bit(code: KeyCode) -> Option<u32> {
    Some(match code {
        KeyCode::Up | KeyCode::Char('w' | 'W') => 0,
        KeyCode::Down | KeyCode::Char('s' | 'S') => 1,
        KeyCode::Left | KeyCode::Char('a' | 'A') => 2,
        KeyCode::Right | KeyCode::Char('d' | 'D') => 3,
        KeyCode::Char('z' | 'Z') => 4,
        KeyCode::Char('x' | 'X') => 5,
        KeyCode::Enter => 6,
        _ => return None,
    })
}

/// Restore the terminal on every exit path — clean quit, Ctrl-C, panic,
/// fault. Declared before the sink so it drops *after* the sink's own
/// `end()` on a normal return, and stands alone as the safety net when
/// we break out without calling `end()`.
struct TerminalGuard;

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
        let mut out = std::io::stdout();
        // Reset attributes, show the cursor. `end()` on the sink does the
        // same on the clean path; this covers every other path.
        let _ = write!(out, "\x1b[0m\x1b[?25h");
        let _ = out.flush();
    }
}

/// Boot a cart for the console, naming it on error. Returns the booted
/// `Host` on success. Mirrors `console::boot` but is kept local so the
/// term loop owns its error shape (stderr + stay-put is the caller's job).
fn boot(
    wasm: &[u8],
    system: bool,
    list: &[ConsoleCart],
    w: i32,
    h: i32,
    name: &str,
) -> Result<Host, String> {
    let metas: Vec<_> = list.iter().map(|c| c.meta.clone()).collect();
    let mut host = if system {
        Host::new_system(wasm, w, h, metas).map_err(|e| format!("load {name}: {e}"))?
    } else {
        Host::new(wasm, w, h).map_err(|e| format!("load {name}: {e}"))?
    };
    if let Err(fault) = host.start() {
        return Err(format!(
            "{name}: fault in start() ({}): {}",
            fault.kind, fault.msg
        ));
    }
    Ok(host)
}

/// `calyx console --carts <dir> --present term`: the interactive SSH
/// launcher loop. Runs forever until Esc, Ctrl-C, or a
/// fault. Returns `Ok(false)` when a cart failed to load mid-session, so
/// the process exits nonzero for CI gates (mirrors the window presenter).
pub fn play_console(
    dir: &Path,
    w: i32,
    h: i32,
    presentation_rate: PresentationRate,
    feed: Feed,
    term_scale: TerminalScale,
) -> Result<bool, String> {
    let (list, roles) = scan_carts(dir)?;
    let (mut host, mut screen, name) = if let Some(boot_wasm) = &roles.boot {
        match boot(boot_wasm, true, &list, w, h, "boot") {
            Ok(host) => (host, ConsoleScreen::Boot, "boot"),
            Err(error) => {
                eprintln!("console: {error} — falling back to launcher");
                (
                    boot(&roles.launcher, true, &list, w, h, "launcher")?,
                    ConsoleScreen::Launcher,
                    "launcher",
                )
            }
        }
    } else {
        (
            boot(&roles.launcher, true, &list, w, h, "launcher")?,
            ConsoleScreen::Launcher,
            "launcher",
        )
    };
    eprintln!("console: booted {name} ({} carts)", list.len());

    // Enter raw mode so keystrokes arrive immediately, unbuffered. A tty
    // is required (SSH provides one); without it this errors and the
    // caller reports it — the term console is a live presenter, not a
    // CI-verifiable one, like the window loop.
    terminal::enable_raw_mode().map_err(|e| format!("enable raw mode: {e}"))?;
    let _guard = TerminalGuard;

    let mut sink = TerminalSink::new(presentation_rate, term_scale);
    sink.begin(w, h, host.palette_rgb());

    let mut keys: u32 = 0;
    let mut errored = false;
    let mut pacer = SimulationPacer::new(Instant::now());

    loop {
        // Drain every pending key event without blocking.
        while event::poll(Duration::from_millis(0)).unwrap_or(false) {
            let Ok(Event::Key(ev)) = event::read() else {
                continue;
            };
            if !handle_key(
                ev,
                &mut keys,
                &mut screen,
                &list,
                &roles.launcher,
                &mut host,
                w,
                h,
                &mut sink,
                &mut errored,
            ) {
                // Quit requested (Esc or Ctrl-C). The
                // [`TerminalGuard`] restores the terminal on drop.
                return Ok(!errored);
            }
        }

        let due = pacer.due(Instant::now());
        if due == 0 {
            std::thread::sleep(Duration::from_millis(1));
            continue;
        }
        for _ in 0..due {
            let f = host.frames_run();
            let btn = (keys as i32) | feed.at(f);
            match host.step(btn) {
                Ok(rec) => {
                    sink.frame(host.fb(), &rec);
                    let action = action_of(&rec.sys);
                    if matches!(action, SysAction::None) {
                        continue;
                    }
                    // Never run a stale catch-up tick after a cart swap.
                    apply_action(
                        action,
                        &list,
                        &roles.launcher,
                        &mut host,
                        w,
                        h,
                        &mut screen,
                        &mut keys,
                        &mut sink,
                        &mut errored,
                    );
                    pacer = SimulationPacer::new(Instant::now());
                    break;
                }
                Err(fault) => {
                    if screen == ConsoleScreen::Boot {
                        eprintln!(
                            "console: boot fault at f{} ({}): {} — falling back to launcher",
                            fault.f, fault.kind, fault.msg
                        );
                        host = boot(&roles.launcher, true, &list, w, h, "launcher")?;
                        screen = ConsoleScreen::Launcher;
                        keys = 0;
                        sink.begin(w, h, host.palette_rgb());
                        pacer = SimulationPacer::new(Instant::now());
                        break;
                    }
                    eprintln!(
                        "console: fault at f{} ({}): {} — exiting",
                        fault.f, fault.kind, fault.msg
                    );
                    return Ok(false);
                }
            }
        }
    }
}

/// Apply one key event. Returns `false` when the loop should quit
/// (Esc or Ctrl-C); `true` to continue. Updates `keys` for console buttons;
/// Backspace returns an active cart to the launcher, mirroring the window
/// presenter, while Escape always quits.
#[allow(clippy::too_many_arguments)]
fn handle_key(
    ev: KeyEvent,
    keys: &mut u32,
    screen: &mut ConsoleScreen,
    list: &[ConsoleCart],
    launcher_wasm: &[u8],
    host: &mut Host,
    w: i32,
    h: i32,
    sink: &mut TerminalSink,
    errored: &mut bool,
) -> bool {
    // Ctrl-C quits from anywhere.
    if ev.modifiers.contains(KeyModifiers::CONTROL) && matches!(ev.code, KeyCode::Char('c' | 'C')) {
        return false;
    }
    // Escape is never overloaded: it quits from anywhere.
    if ev.code == KeyCode::Esc {
        return false;
    }
    // Backspace: active cart → launcher; already-home is a no-op.
    if ev.code == KeyCode::Backspace && *screen != ConsoleScreen::Launcher {
        eprintln!("console: exit -> launcher");
        match boot(launcher_wasm, true, list, w, h, "launcher") {
            Ok(new) => {
                *host = new;
                *screen = ConsoleScreen::Launcher;
                *keys = 0;
                sink.begin(w, h, host.palette_rgb());
            }
            Err(e) => {
                eprintln!("console: {e} — staying put");
                *errored = true;
            }
        }
        return true;
    }
    // Console buttons: Press sets the bit, Release clears it. Repeat and
    // any future `KeyEventKind` variants leave `keys` unchanged (held is
    // held). `KeyEventKind` is `#[non_exhaustive]`, so the catch-all stays.
    let Some(bit) = key_bit(ev.code) else {
        return true;
    };
    match ev.kind {
        KeyEventKind::Press => *keys |= 1 << bit,
        KeyEventKind::Release => *keys &= !(1 << bit),
        _ => {}
    }
    true
}

/// Act on a frame's sys events (ABI §4b). On a successful boot the sink
/// is re-begun with the new palette and `in_launcher` is flipped. A
/// failed boot stays put and flags the session errored.
#[allow(clippy::too_many_arguments)]
fn apply_action(
    action: SysAction,
    list: &[ConsoleCart],
    launcher_wasm: &[u8],
    host: &mut Host,
    w: i32,
    h: i32,
    screen: &mut ConsoleScreen,
    keys: &mut u32,
    sink: &mut TerminalSink,
    errored: &mut bool,
) -> bool {
    match action {
        SysAction::Launch(i) => {
            let Some(cart) = list.get(i) else {
                eprintln!("console: launch {i} out of range");
                *errored = true;
                return false;
            };
            if cart.display == DisplayProfile::Hd {
                eprintln!(
                    "console: {} requires an HD-capable presenter (window, SDL, or headless)",
                    cart.meta.name
                );
                *errored = true;
                return false;
            }
            let (name, system) = (cart.meta.name.clone(), cart.system);
            let wasm = match std::fs::read(&cart.wasm) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("console: read {} ({name}): {e}", cart.wasm.display());
                    *errored = true;
                    return false;
                }
            };
            eprintln!("console: launch {i} -> {name}");
            match boot(&wasm, system, list, w, h, &name) {
                Ok(new) => {
                    *host = new;
                    *screen = ConsoleScreen::Cart;
                    *keys = 0;
                    sink.begin(w, h, host.palette_rgb());
                    true
                }
                Err(e) => {
                    eprintln!("console: {e} — staying put");
                    *errored = true;
                    false
                }
            }
        }
        SysAction::Exit => {
            eprintln!("console: exit -> launcher");
            match boot(launcher_wasm, true, list, w, h, "launcher") {
                Ok(new) => {
                    *host = new;
                    *screen = ConsoleScreen::Launcher;
                    *keys = 0;
                    sink.begin(w, h, host.palette_rgb());
                    true
                }
                Err(e) => {
                    eprintln!("console: {e} — staying put");
                    *errored = true;
                    false
                }
            }
        }
        SysAction::None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_mapping_matches_window_and_web() {
        // window::key_bit + web/src/canvas.mjs KEY_TO_BIT, bit for bit.
        assert_eq!(key_bit(KeyCode::Up), Some(0));
        assert_eq!(key_bit(KeyCode::Char('w')), Some(0));
        assert_eq!(key_bit(KeyCode::Char('W')), Some(0));
        assert_eq!(key_bit(KeyCode::Down), Some(1));
        assert_eq!(key_bit(KeyCode::Char('s')), Some(1));
        assert_eq!(key_bit(KeyCode::Char('S')), Some(1));
        assert_eq!(key_bit(KeyCode::Left), Some(2));
        assert_eq!(key_bit(KeyCode::Char('a')), Some(2));
        assert_eq!(key_bit(KeyCode::Char('A')), Some(2));
        assert_eq!(key_bit(KeyCode::Right), Some(3));
        assert_eq!(key_bit(KeyCode::Char('d')), Some(3));
        assert_eq!(key_bit(KeyCode::Char('D')), Some(3));
        assert_eq!(key_bit(KeyCode::Char('z')), Some(4));
        assert_eq!(key_bit(KeyCode::Char('Z')), Some(4));
        assert_eq!(key_bit(KeyCode::Char('x')), Some(5));
        assert_eq!(key_bit(KeyCode::Char('X')), Some(5));
        assert_eq!(key_bit(KeyCode::Enter), Some(6));
        // Shell navigation is handled by the caller, not as console buttons.
        assert_eq!(key_bit(KeyCode::Esc), None);
        assert_eq!(key_bit(KeyCode::Backspace), None);
        assert_eq!(key_bit(KeyCode::Char(' ')), None);
    }
}
