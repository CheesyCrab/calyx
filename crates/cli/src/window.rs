//! The native window presenter — a window on the verified
//! framebuffer.
//!
//! A dumb sink by design: `winit` + `softbuffer` (CPU blit, no GPU
//! dependency), a fixed-step loop
//! driving the same [`Host`] the headless verifier uses, and the same
//! key → `btn` mapping the web shell pins (`web/src/canvas.mjs`
//! KEY_TO_BIT: arrows/WASD, Z=A, X=B, Enter=Start). This surface is
//! **unverifiable** (README, "Scope frontiers"); nothing here changes
//! what a run hashes, and no feature exists that only matters on glass.
//!
//! The pure pieces — key mapping, frame pacing, the scaled blit — are
//! plain functions with unit tests; only the event-loop shell needs a
//! display.

use std::collections::HashSet;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Instant;

use calyx_core::{Fault, Feed, Framebuffer, Host};

#[cfg(feature = "audio")]
use crate::audio::Speaker;
use crate::confirmation::{draw_u32, Confirmation, PendingAction};
use crate::console::{
    action_of, scan_carts, ConsoleCart, ConsoleScreen, DisplayProfile, InputProfile, SysAction,
};
use crate::timing::{PresentationRate, SimulationPacer};
use crate::watch::Watcher;

use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

/// The console face on a keyboard — identical to the web shell's
/// `KEY_TO_BIT` so the two presenters feel like one console.
pub fn key_bit(code: KeyCode) -> Option<u32> {
    Some(match code {
        KeyCode::ArrowUp | KeyCode::KeyW => 0,
        KeyCode::ArrowDown | KeyCode::KeyS => 1,
        KeyCode::ArrowLeft | KeyCode::KeyA => 2,
        KeyCode::ArrowRight | KeyCode::KeyD => 3,
        KeyCode::KeyZ => 4,
        KeyCode::KeyX => 5,
        KeyCode::Enter => 6,
        _ => return None,
    })
}

pub fn extended_key_bit(code: KeyCode) -> Option<u32> {
    Some(match code {
        KeyCode::ArrowUp => 0,
        KeyCode::ArrowDown => 1,
        KeyCode::ArrowLeft => 2,
        KeyCode::ArrowRight => 3,
        KeyCode::KeyZ => 4,
        KeyCode::KeyX => 5,
        KeyCode::Enter => 6,
        KeyCode::KeyA => 7,
        KeyCode::KeyS => 8,
        KeyCode::KeyQ => 9,
        KeyCode::KeyW => 10,
        _ => return None,
    })
}

/// Nearest-neighbor blit of the indexed framebuffer into an 0RGB pixel
/// buffer at the largest integer scale that fits, centered, letterboxed
/// black. If the window is smaller than the framebuffer the image is
/// cropped (scale never drops below 1) — still correct pixels, no
/// filtering ever.
pub fn blit_scaled(
    px: &[u8],
    fbw: usize,
    fbh: usize,
    lut: &[u32; 256],
    out: &mut [u32],
    ow: usize,
    oh: usize,
) {
    blit_scaled_pixels(fbw, fbh, out, ow, oh, |at| lut[px[at] as usize]);
}
fn blit_scaled_pixels(
    fbw: usize,
    fbh: usize,
    out: &mut [u32],
    ow: usize,
    oh: usize,
    pixel: impl Fn(usize) -> u32,
) {
    let scale = (ow / fbw).min(oh / fbh).max(1);
    let x0 = (ow as isize - (fbw * scale) as isize) / 2;
    let y0 = (oh as isize - (fbh * scale) as isize) / 2;
    for oy in 0..oh {
        let sy = (oy as isize - y0).div_euclid(scale as isize);
        let row_dst = &mut out[oy * ow..(oy + 1) * ow];
        if sy < 0 || sy >= fbh as isize {
            row_dst.fill(0);
            continue;
        }

        for (ox, dst) in row_dst.iter_mut().enumerate() {
            let sx = (ox as isize - x0).div_euclid(scale as isize);
            *dst = if sx < 0 || sx >= fbw as isize {
                0
            } else {
                pixel(sy as usize * fbw + sx as usize)
            };
        }
    }
}

fn palette_lut(entries: &[(u8, u8, u8)]) -> [u32; 256] {
    let mut lut = [0u32; 256];
    for (i, &(r, g, b)) in entries.iter().enumerate().take(256) {
        lut[i] = (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b);
    }
    lut
}

type Sbuf = softbuffer::Surface<Arc<Window>, Arc<Window>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellAction {
    Quit,
    Home,
}

fn shell_action(code: KeyCode, in_launcher: bool) -> Option<ShellAction> {
    match code {
        KeyCode::Escape => Some(ShellAction::Quit),
        KeyCode::Backspace if !in_launcher => Some(ShellAction::Home),
        _ => None,
    }
}

/// Console-mode state: the installed list + the launcher to return to
/// Present only under `calyx console`.
struct ConsoleCtx {
    list: Vec<ConsoleCart>,
    launcher: Vec<u8>,
    hd_boot: Option<Vec<u8>>,
    screen: ConsoleScreen,
    pending_hd: Option<usize>,
}

struct App {
    host: Host,
    title: String,
    fbw: usize,
    fbh: usize,
    presentation_rate: PresentationRate,
    presentation_override: Option<PresentationRate>,
    feed: Feed,
    keys: u32,
    held_codes: HashSet<KeyCode>,
    suppressed_codes: HashSet<KeyCode>,
    lut: [u32; 256],
    window: Option<Arc<Window>>,
    surface: Option<Sbuf>,
    pacer: SimulationPacer,
    fault: Option<Fault>,
    fatal: Option<String>,
    /// A console cart failed to load/read mid-session. The session keeps
    /// running (staying put is the right UX on glass), but the process
    /// exits nonzero so a CI gate checking `$?` sees it (T11.5 F5/F6).
    errored: bool,
    watcher: Option<Watcher>,
    console: Option<ConsoleCtx>,
    confirmation: Option<Confirmation>,
    input_profile: InputProfile,
    #[cfg(feature = "audio")]
    audio: Option<Speaker>,
}

impl App {
    fn in_cart(&self) -> bool {
        self.console
            .as_ref()
            .is_some_and(|console| console.screen == ConsoleScreen::Cart)
    }

    fn open_confirmation(&mut self, action: PendingAction) {
        self.confirmation = Some(Confirmation::new(action));
        self.suppressed_codes
            .extend(self.held_codes.iter().copied());
        self.keys = 0;
        #[cfg(feature = "audio")]
        if let Some(audio) = &mut self.audio {
            audio.reset();
        }
        if let Some(window) = &self.window {
            window.set_title(&format!(
                "{} — {}",
                self.title,
                Confirmation::new(action).question()
            ));
            window.request_redraw();
        }
    }

    fn close_confirmation(&mut self) {
        self.confirmation = None;
        self.keys = 0;
        self.pacer = SimulationPacer::new(Instant::now());
        if let Some(window) = &self.window {
            window.set_title(&self.title);
            window.request_redraw();
        }
    }

    /// `calyx watch --present window`: swap in the rebuilt cart and
    /// restart from frame 0 (the T9 determinism story — a reload replays
    /// exactly like a cold start). A cart that won't load or faults in
    /// start() keeps the old one running.
    fn poll_reload(&mut self) {
        if self.confirmation.is_some() {
            return;
        }
        let Some(watcher) = &mut self.watcher else {
            return;
        };
        let Some(bytes) = watcher.poll() else {
            return;
        };
        let mut host = match Host::new(&bytes, self.fbw as i32, self.fbh as i32) {
            Ok(host) => host,
            Err(e) => {
                eprintln!("watch: load error: {e} — keeping the old cart");
                return;
            }
        };
        if let Err(fault) = host.start() {
            eprintln!(
                "watch: fault in start() ({}): {} — keeping the old cart",
                fault.kind, fault.msg
            );
            return;
        }
        self.lut = palette_lut(host.palette_rgb());
        self.host = host;
        #[cfg(feature = "audio")]
        if let Some(audio) = &mut self.audio {
            audio.reset();
        }
        self.fault = None;
        self.pacer = SimulationPacer::new(Instant::now());
        if let Some(w) = &self.window {
            w.set_title(&self.title);
            w.request_redraw();
        }
        eprintln!("watch: running (load #{})", watcher.reloads + 1);
    }

    /// Console mode: boot a cart in place — fresh Host, fresh palette,
    /// pacer reset, keys released (a held A must not leak into the
    /// launched cart's first frame). Errors name the cart and flag the
    /// session as errored. Returns whether the boot took, so callers
    /// only flip `in_launcher` on success (a failed boot stays put).
    fn console_boot(
        &mut self,
        wasm: &[u8],
        system: bool,
        name: &str,
        title: String,
        display: DisplayProfile,
        input: InputProfile,
        presentation: PresentationRate,
        synthetic_metas: Option<Vec<calyx_core::SysCart>>,
    ) -> bool {
        let list = synthetic_metas.unwrap_or_else(|| match &self.console {
            Some(c) => c.list.iter().map(|c| c.meta.clone()).collect(),
            None => Vec::new(),
        });
        let (fbw, fbh) = display.dimensions();
        let mut host = match if system {
            Host::new_system(wasm, fbw, fbh, list)
        } else {
            Host::new(wasm, fbw, fbh)
        } {
            Ok(host) => host,
            Err(e) => {
                eprintln!("console: load {name}: {e} — staying put");
                self.errored = true;
                return false;
            }
        };
        if let Err(fault) = host.start() {
            eprintln!(
                "console: {name}: fault in start() ({}): {} — staying put",
                fault.kind, fault.msg
            );
            self.errored = true;
            return false;
        }
        self.lut = palette_lut(host.palette_rgb());
        self.host = host;
        self.fbw = fbw as usize;
        self.fbh = fbh as usize;
        self.input_profile = input;
        self.presentation_rate = self.presentation_override.unwrap_or(presentation);
        #[cfg(feature = "audio")]
        if let Some(audio) = &mut self.audio {
            audio.reset();
        }
        self.fault = None;
        self.keys = 0;
        self.pacer = SimulationPacer::new(Instant::now());
        self.title = title;
        if let Some(w) = &self.window {
            w.set_title(&self.title);
            w.request_redraw();
        }
        true
    }

    /// Act on a frame's sys events (ABI §4b) — the runner side of
    /// launch/exit intent.
    fn console_act(&mut self, action: SysAction) {
        match action {
            SysAction::Launch(i) => {
                let Some(console) = &self.console else {
                    return;
                };
                let target = if console.screen == ConsoleScreen::HdBoot {
                    if i != 0 {
                        eprintln!("console: hd-boot launch {i} out of range");
                        self.errored = true;
                        self.console_return_to_launcher();
                        return;
                    }
                    console.pending_hd
                } else {
                    Some(i)
                };
                let Some(target) = target else {
                    eprintln!("console: hd-boot has no pending target");
                    self.errored = true;
                    self.console_return_to_launcher();
                    return;
                };
                let Some(cart) = console.list.get(target) else {
                    eprintln!("console: launch {target} out of range");
                    self.errored = true;
                    return;
                };
                let name = cart.meta.name.clone();
                let system = cart.system;
                let path = cart.wasm.clone();
                let display = cart.display;
                let input = cart.input;
                let presentation = cart.presentation;
                let target_meta = cart.meta.clone();
                let from_hd_boot = console.screen == ConsoleScreen::HdBoot;
                let hd_boot = console.hd_boot.clone();

                if display == DisplayProfile::Hd && !from_hd_boot {
                    let Some(hd_boot) = hd_boot else {
                        eprintln!("console: {name} requires the missing hd-boot role");
                        self.errored = true;
                        self.console_return_to_launcher();
                        return;
                    };
                    if self.console_boot(
                        &hd_boot,
                        true,
                        "hd-boot",
                        "calyx — HD".to_string(),
                        DisplayProfile::Hd,
                        InputProfile::Classic,
                        PresentationRate::Hz60,
                        Some(vec![target_meta]),
                    ) {
                        if let Some(c) = &mut self.console {
                            c.screen = ConsoleScreen::HdBoot;
                            c.pending_hd = Some(target);
                        }
                    }
                    return;
                }
                match std::fs::read(&path) {
                    Ok(wasm) => {
                        eprintln!("console: launch {i} -> {name}");
                        // flip in_launcher only if the boot took — a
                        // failed boot stays on the launcher, and Esc
                        // must keep meaning "quit" there.
                        if self.console_boot(
                            &wasm,
                            system,
                            &name,
                            format!("calyx — {name}"),
                            display,
                            input,
                            presentation,
                            None,
                        ) {
                            if let Some(c) = &mut self.console {
                                c.screen = ConsoleScreen::Cart;
                                c.pending_hd = None;
                            }
                        } else if from_hd_boot {
                            self.console_return_to_launcher();
                        }
                    }
                    Err(e) => {
                        eprintln!("console: read {} ({name}): {e}", path.display());
                        self.errored = true;
                        if from_hd_boot {
                            self.console_return_to_launcher();
                        }
                    }
                }
            }
            SysAction::Exit => self.console_return_to_launcher(),
            SysAction::None => {}
        }
    }

    fn console_return_to_launcher(&mut self) {
        let Some(console) = &mut self.console else {
            return;
        };
        eprintln!("console: exit -> launcher");
        let wasm = console.launcher.clone();
        if self.console_boot(
            &wasm,
            true,
            "launcher",
            "calyx — launcher".to_string(),
            DisplayProfile::Classic,
            InputProfile::Classic,
            PresentationRate::Hz60,
            None,
        ) {
            if let Some(c) = &mut self.console {
                c.screen = ConsoleScreen::Launcher;
                c.pending_hd = None;
            }
        }
    }

    fn step_due(&mut self) {
        if self.fault.is_some() || self.confirmation.is_some() {
            return;
        }
        let due = self.pacer.due(Instant::now());
        let mut redraw = false;
        for _ in 0..due {
            let f = self.host.frames_run();
            let btn = (self.keys as i32) | self.feed.at(f);
            match self.host.step_live(btn) {
                Ok(rec) => {
                    #[cfg(feature = "audio")]
                    if let Some(audio) = &mut self.audio {
                        audio.frame(&rec.audio);
                    }
                    if self.console.is_some() {
                        let action = action_of(&rec.sys);
                        if !matches!(action, SysAction::None) {
                            self.console_act(action);
                            redraw = true;
                            break; // fresh cart: don't run stale steps
                        }
                    }
                    redraw |= self
                        .presentation_rate
                        .should_present(self.host.frames_run());
                }
                Err(fault) => {
                    eprintln!("fault at f{} ({}): {}", fault.f, fault.kind, fault.msg);
                    if self.console.as_ref().is_some_and(|console| {
                        matches!(console.screen, ConsoleScreen::Boot | ConsoleScreen::HdBoot)
                    }) {
                        eprintln!("console: boot fault — falling back to launcher");
                        self.console_return_to_launcher();
                        redraw = true;
                        break;
                    }
                    if let Some(w) = &self.window {
                        w.set_title(&format!(
                            "{} — FAULT f{} ({})",
                            self.title, fault.f, fault.kind
                        ));
                    }
                    self.fault = Some(fault);
                    redraw = true;
                    break;
                }
            }
        }
        if redraw {
            if let Some(w) = &self.window {
                w.request_redraw();
            }
        }
    }

    fn redraw(&mut self) -> Result<(), String> {
        let (Some(window), Some(surface)) = (&self.window, &mut self.surface) else {
            return Ok(());
        };
        let size = window.inner_size();
        let (Some(w), Some(h)) = (NonZeroU32::new(size.width), NonZeroU32::new(size.height)) else {
            return Ok(()); // minimized
        };
        surface.resize(w, h).map_err(|e| format!("resize: {e}"))?;
        let mut buffer = surface.buffer_mut().map_err(|e| format!("buffer: {e}"))?;
        let fb: &Framebuffer = self.host.fb();
        if fb.true_color {
            blit_scaled_pixels(
                self.fbw,
                self.fbh,
                &mut buffer,
                size.width as usize,
                size.height as usize,
                |at| {
                    let p = &fb.px[at * 4..at * 4 + 3];
                    (u32::from(p[0]) << 16) | (u32::from(p[1]) << 8) | u32::from(p[2])
                },
            );
        } else {
            blit_scaled(
                &fb.px,
                self.fbw,
                self.fbh,
                &self.lut,
                &mut buffer,
                size.width as usize,
                size.height as usize,
            );
        }
        if let Some(prompt) = self.confirmation {
            draw_u32(
                prompt,
                &mut buffer,
                size.width as usize,
                size.height as usize,
            );
        }
        buffer.present().map_err(|e| format!("present: {e}"))?;
        Ok(())
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title(&self.title)
            .with_inner_size(LogicalSize::new(
                (self.fbw * 2) as f64,
                (self.fbh * 2) as f64,
            ));
        let created = event_loop
            .create_window(attrs)
            .map_err(|e| format!("create window: {e}"))
            .map(Arc::new);
        let window = match created {
            Ok(w) => w,
            Err(e) => {
                self.fatal = Some(e);
                event_loop.exit();
                return;
            }
        };
        let surface = softbuffer::Context::new(window.clone())
            .and_then(|ctx| softbuffer::Surface::new(&ctx, window.clone()));
        match surface {
            Ok(s) => {
                self.surface = Some(s);
                self.window = Some(window);
                self.pacer = SimulationPacer::new(Instant::now());
            }
            Err(e) => {
                self.fatal = Some(format!("softbuffer: {e}"));
                event_loop.exit();
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key: PhysicalKey::Code(code),
                        state,
                        repeat: false,
                        ..
                    },
                ..
            } => {
                match state {
                    ElementState::Pressed => {
                        self.held_codes.insert(code);
                    }
                    ElementState::Released => {
                        self.held_codes.remove(&code);
                        self.suppressed_codes.remove(&code);
                        let bit = if self.input_profile == InputProfile::Extended {
                            extended_key_bit(code)
                        } else {
                            key_bit(code)
                        };
                        if let Some(bit) = bit {
                            self.keys &= !(1 << bit);
                        }
                    }
                }
                if state == ElementState::Pressed {
                    if self.confirmation.is_some() && !self.suppressed_codes.is_empty() {
                        return;
                    }
                    if let Some(mut prompt) = self.confirmation {
                        match code {
                            KeyCode::ArrowLeft | KeyCode::ArrowRight | KeyCode::Tab => {
                                prompt.toggle();
                                self.confirmation = Some(prompt);
                                if let Some(window) = &self.window {
                                    window.request_redraw();
                                }
                            }
                            KeyCode::Enter | KeyCode::KeyZ => {
                                let accepted = prompt.accepted();
                                self.suppressed_codes.insert(code);
                                self.close_confirmation();
                                match accepted {
                                    Some(PendingAction::Home) => self.console_return_to_launcher(),
                                    Some(PendingAction::Quit) => event_loop.exit(),
                                    None => {}
                                }
                            }
                            KeyCode::Escape | KeyCode::KeyX => {
                                self.suppressed_codes.insert(code);
                                self.close_confirmation();
                            }
                            _ => {}
                        }
                        return;
                    }
                    let in_launcher = self
                        .console
                        .as_ref()
                        .is_none_or(|c| c.screen == ConsoleScreen::Launcher);
                    match shell_action(code, in_launcher) {
                        Some(ShellAction::Quit) => {
                            if self.in_cart() {
                                self.open_confirmation(PendingAction::Quit);
                            } else {
                                event_loop.exit();
                            }
                            return;
                        }
                        Some(ShellAction::Home) => {
                            if self.in_cart() {
                                self.open_confirmation(PendingAction::Home);
                            }
                            return;
                        }
                        None => {}
                    }
                }
                if state == ElementState::Pressed && !self.suppressed_codes.contains(&code) {
                    let bit = if self.input_profile == InputProfile::Extended {
                        extended_key_bit(code)
                    } else {
                        key_bit(code)
                    };
                    if let Some(bit) = bit {
                        self.keys |= 1 << bit;
                    }
                }
            }
            WindowEvent::RedrawRequested => {
                if let Err(e) = self.redraw() {
                    self.fatal = Some(e);
                    event_loop.exit();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.poll_reload();
        self.step_due();
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.pacer.next_at()));
    }
}

/// Open a window and play the cart until close/Escape (or a fault, which
/// freezes the last verified frame). A scripted feed, when given, is
/// OR-ed with the keyboard — deterministic replay with live override.
/// With a `Watcher` (T9), the cart hot-swaps when it changes on disk.
#[allow(clippy::too_many_arguments)]
pub fn play(
    wasm: &[u8],
    cart_name: &str,
    w: i32,
    h: i32,
    presentation_rate: PresentationRate,
    feed: Feed,
    watcher: Option<Watcher>,
    audio_enabled: bool,
) -> Result<bool, String> {
    let mut host = Host::new(wasm, w, h).map_err(|e| format!("{e}"))?;
    if let Err(fault) = host.start() {
        return Err(format!("fault in start() ({}): {}", fault.kind, fault.msg));
    }
    run_app(
        host,
        format!("calyx — {cart_name}"),
        w,
        h,
        presentation_rate,
        Some(presentation_rate),
        feed,
        watcher,
        None,
        audio_enabled,
    )
}

/// `calyx console --present window`: boot-to-launcher → pick → play →
/// back. Backspace in a game returns to the launcher; Escape
/// always quits. Returns `Ok(false)` when a cart failed to load/read
/// mid-session, so the process exits nonzero for CI gates.
pub fn play_console(
    dir: &std::path::Path,
    _w: i32,
    _h: i32,
    presentation_override: Option<PresentationRate>,
    audio_enabled: bool,
) -> Result<bool, String> {
    let (list, roles) = scan_carts(dir)?;
    let (w, h) = DisplayProfile::Classic.dimensions();
    let metas: Vec<_> = list.iter().map(|c| c.meta.clone()).collect();
    let (initial, mut screen, mut name) = roles.boot.as_ref().map_or(
        (&roles.launcher, ConsoleScreen::Launcher, "launcher"),
        |boot| (boot, ConsoleScreen::Boot, "boot"),
    );
    let mut host = match Host::new_system(initial, w, h, metas.clone()) {
        Ok(host) => host,
        Err(error) if screen == ConsoleScreen::Boot => {
            eprintln!("console: load boot: {error} — falling back to launcher");
            screen = ConsoleScreen::Launcher;
            name = "launcher";
            Host::new_system(&roles.launcher, w, h, metas.clone()).map_err(|e| format!("{e}"))?
        }
        Err(error) => return Err(format!("{error}")),
    };
    if let Err(fault) = host.start() {
        if screen == ConsoleScreen::Boot {
            eprintln!(
                "console: boot fault in start() ({}): {} — falling back to launcher",
                fault.kind, fault.msg
            );
            host = Host::new_system(&roles.launcher, w, h, metas).map_err(|e| format!("{e}"))?;
            host.start().map_err(|fault| {
                format!("launcher fault in start() ({}): {}", fault.kind, fault.msg)
            })?;
            screen = ConsoleScreen::Launcher;
            name = "launcher";
        } else {
            return Err(format!(
                "launcher fault in start() ({}): {}",
                fault.kind, fault.msg
            ));
        }
    }
    eprintln!("console: booted {name} ({} carts)", list.len());
    let console = ConsoleCtx {
        list,
        launcher: roles.launcher,
        hd_boot: roles.hd_boot,
        screen,
        pending_hd: None,
    };
    run_app(
        host,
        format!("calyx — {name}"),
        w,
        h,
        presentation_override.unwrap_or(PresentationRate::Hz60),
        presentation_override,
        Feed::empty(),
        None,
        Some(console),
        audio_enabled,
    )
}

#[allow(clippy::too_many_arguments)]
fn run_app(
    host: Host,
    title: String,
    w: i32,
    h: i32,
    presentation_rate: PresentationRate,
    presentation_override: Option<PresentationRate>,
    feed: Feed,
    watcher: Option<Watcher>,
    console: Option<ConsoleCtx>,
    audio_enabled: bool,
) -> Result<bool, String> {
    let lut = palette_lut(host.palette_rgb());
    let event_loop = EventLoop::new().map_err(|e| format!("event loop: {e}"))?;
    #[cfg(feature = "audio")]
    let audio = if audio_enabled {
        match Speaker::open() {
            Ok(speaker) => Some(speaker),
            Err(e) => {
                eprintln!("audio: unavailable ({e}); continuing muted");
                None
            }
        }
    } else {
        None
    };
    #[cfg(not(feature = "audio"))]
    if audio_enabled {
        eprintln!("audio: this calyx was built without the `audio` feature; continuing muted");
    }

    let mut app = App {
        host,
        title,
        fbw: w as usize,
        fbh: h as usize,
        presentation_rate,
        presentation_override,
        feed,
        keys: 0,
        held_codes: HashSet::new(),
        suppressed_codes: HashSet::new(),
        lut,
        window: None,
        surface: None,
        pacer: SimulationPacer::new(Instant::now()),
        fault: None,
        fatal: None,
        errored: false,
        watcher,
        console,
        confirmation: None,
        input_profile: InputProfile::Classic,
        #[cfg(feature = "audio")]
        audio,
    };
    event_loop
        .run_app(&mut app)
        .map_err(|e| format!("event loop: {e}"))?;
    match app.fatal {
        Some(e) => Err(e),
        None => Ok(!app.errored),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_mapping_matches_the_web_shell() {
        // web/src/canvas.mjs KEY_TO_BIT, bit for bit.
        assert_eq!(key_bit(KeyCode::ArrowUp), Some(0));
        assert_eq!(key_bit(KeyCode::KeyW), Some(0));
        assert_eq!(key_bit(KeyCode::ArrowDown), Some(1));
        assert_eq!(key_bit(KeyCode::KeyS), Some(1));
        assert_eq!(key_bit(KeyCode::ArrowLeft), Some(2));
        assert_eq!(key_bit(KeyCode::KeyA), Some(2));
        assert_eq!(key_bit(KeyCode::ArrowRight), Some(3));
        assert_eq!(key_bit(KeyCode::KeyD), Some(3));
        assert_eq!(key_bit(KeyCode::KeyZ), Some(4));
        assert_eq!(key_bit(KeyCode::KeyX), Some(5));
        assert_eq!(key_bit(KeyCode::Enter), Some(6));
        assert_eq!(key_bit(KeyCode::Space), None);
    }

    #[test]
    fn escape_quits_and_backspace_only_goes_home_from_a_cart() {
        assert_eq!(shell_action(KeyCode::Escape, true), Some(ShellAction::Quit));
        assert_eq!(
            shell_action(KeyCode::Escape, false),
            Some(ShellAction::Quit)
        );
        assert_eq!(
            shell_action(KeyCode::Backspace, false),
            Some(ShellAction::Home)
        );
        assert_eq!(shell_action(KeyCode::Backspace, true), None);
    }

    #[test]
    fn blit_scales_centers_and_letterboxes() {
        // 1x1 framebuffer into 4x2: scale 2, centered on x, letterboxed.
        let px = [1u8];
        let mut lut = [0u32; 256];
        lut[1] = 0x00ff0000;
        let mut out = [0xdead_beefu32; 8];
        blit_scaled(&px, 1, 1, &lut, &mut out, 4, 2);
        let r = 0x00ff0000;
        #[rustfmt::skip]
        let want = [
            0, r, r, 0,
            0, r, r, 0,
        ];
        assert_eq!(out, want);
    }

    #[test]
    fn blit_crops_when_window_is_smaller() {
        // 4x1 fb into 2x1 out: scale clamps to 1, centered crop.
        let px = [1u8, 2, 3, 4];
        let mut lut = [0u32; 256];
        for (i, entry) in lut.iter_mut().enumerate().take(5) {
            *entry = i as u32;
        }
        let mut out = [9u32; 2];
        blit_scaled(&px, 4, 1, &lut, &mut out, 2, 1);
        assert_eq!(out, [2, 3]); // the centered 2px of the 4
    }
}
