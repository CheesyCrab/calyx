//! Portable SDL2 presenter.
//!
//! This is another dumb native presenter over the same [`Host`] as the
//! verifier and winit window. SDL owns fullscreen video, controller discovery,
//! and the speaker queue; cart execution, input bits, audio events, and console
//! chainloading remain unchanged.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use calyx_core::{AudioEvent, Fault, Feed, Host, InputMethod};
use sdl2::audio::{AudioQueue, AudioSpecDesired};
use sdl2::controller::{Axis, Button, GameController};
use sdl2::event::Event;
use sdl2::keyboard::Keycode;
use sdl2::pixels::{Color, PixelFormatEnum};
use sdl2::render::{Canvas, Texture};
use sdl2::video::Window;

use crate::audio::ToneSynth;
use crate::confirmation::{draw_argb8888 as draw_confirmation, Confirmation, PendingAction};
use crate::console::{
    action_of, scan_carts, ConsoleCart, ConsoleScreen, DisplayProfile, InputProfile, SysAction,
};
use crate::perf_overlay::{
    draw_argb8888 as draw_perf, ChordButton, PerfChord, PerfChordAction, PerfLog, PerfStats,
};
use crate::timing::{PresentationRate, SimulationPacer};
use crate::watch::Watcher;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellAction {
    Quit,
    Home,
}

const STICK_PRESS_THRESHOLD: i16 = 16_384;
const STICK_RELEASE_THRESHOLD: i16 = 8_192;

fn key_bit(code: Keycode) -> Option<u32> {
    Some(match code {
        Keycode::Up | Keycode::W => 0,
        Keycode::Down | Keycode::S => 1,
        Keycode::Left | Keycode::A => 2,
        Keycode::Right | Keycode::D => 3,
        Keycode::Z => 4,
        Keycode::X => 5,
        Keycode::Return => 6,
        _ => return None,
    })
}

fn extended_key_bit(code: Keycode) -> Option<u32> {
    Some(match code {
        Keycode::Up => 0,
        Keycode::Down => 1,
        Keycode::Left => 2,
        Keycode::Right => 3,
        Keycode::Z => 4,
        Keycode::X => 5,
        Keycode::Return => 6,
        Keycode::A => 7,
        Keycode::S => 8,
        Keycode::Q => 9,
        Keycode::W => 10,
        _ => return None,
    })
}

fn perf_key(code: Keycode) -> Option<ChordButton> {
    match code {
        Keycode::A => Some(ChordButton::X),
        Keycode::S => Some(ChordButton::Y),
        Keycode::Q => Some(ChordButton::L),
        Keycode::W => Some(ChordButton::R),
        _ => None,
    }
}

fn perf_button(button: Button) -> Option<ChordButton> {
    match button {
        Button::X => Some(ChordButton::X),
        Button::Y => Some(ChordButton::Y),
        Button::LeftShoulder => Some(ChordButton::L),
        Button::RightShoulder => Some(ChordButton::R),
        _ => None,
    }
}

fn controller_bit(button: Button) -> Option<u32> {
    Some(match button {
        Button::DPadUp => 0,
        Button::DPadDown => 1,
        Button::DPadLeft => 2,
        Button::DPadRight => 3,
        Button::A => 4,
        Button::B => 5,
        Button::Start => 6,
        _ => return None,
    })
}

fn extended_controller_bit(button: Button) -> Option<u32> {
    Some(match button {
        Button::DPadUp => 0,
        Button::DPadDown => 1,
        Button::DPadLeft => 2,
        Button::DPadRight => 3,
        Button::A => 4,
        Button::B => 5,
        Button::Start => 6,
        Button::X => 7,
        Button::Y => 8,
        Button::LeftShoulder => 9,
        Button::RightShoulder => 10,
        _ => return None,
    })
}

fn stick_axis_bits(axis: Axis, value: i16, current: u32) -> u32 {
    let (negative_bit, positive_bit) = match axis {
        Axis::LeftX => (2, 3),
        Axis::LeftY => (0, 1),
        _ => return current,
    };
    let negative_mask = 1 << negative_bit;
    let positive_mask = 1 << positive_bit;
    let mut next = current;

    if value <= -STICK_PRESS_THRESHOLD {
        next |= negative_mask;
        next &= !positive_mask;
    } else if value >= STICK_PRESS_THRESHOLD {
        next |= positive_mask;
        next &= !negative_mask;
    } else {
        if value >= -STICK_RELEASE_THRESHOLD {
            next &= !negative_mask;
        }
        if value <= STICK_RELEASE_THRESHOLD {
            next &= !positive_mask;
        }
    }
    next
}

fn key_shell_action(code: Keycode, in_launcher: bool) -> Option<ShellAction> {
    match code {
        Keycode::Escape => Some(ShellAction::Quit),
        Keycode::Backspace if !in_launcher => Some(ShellAction::Home),
        _ => None,
    }
}

fn controller_shell_action(button: Button, in_launcher: bool) -> Option<ShellAction> {
    match button {
        // Xbox Back, Legion View, and the corresponding mapped Select/View
        // button on Linux handhelds all arrive through this SDL role.
        Button::Back if !in_launcher => Some(ShellAction::Home),
        Button::Guide => Some(ShellAction::Quit),
        _ => None,
    }
}

struct SdlAudio {
    queue: AudioQueue<f32>,
    synth: ToneSynth,
    max_queued_bytes: u32,
}

impl SdlAudio {
    fn open(sdl: &sdl2::Sdl) -> Result<Self, String> {
        let audio = sdl.audio()?;
        let desired = AudioSpecDesired {
            freq: Some(48_000),
            channels: Some(1),
            samples: Some(1024),
        };
        let queue = audio.open_queue::<f32, _>(None, &desired)?;
        let sample_rate = queue.spec().freq.max(1) as u32;
        queue.resume();
        Ok(Self {
            queue,
            synth: ToneSynth::new(sample_rate),
            max_queued_bytes: sample_rate.saturating_mul(2),
        })
    }

    fn frame(&mut self, events: &[AudioEvent]) {
        // Presentation can drop stale PCM, never cart frames. Half a second is
        // generous enough for device jitter without letting latency run away.
        if self.queue.size() > self.max_queued_bytes {
            self.queue.clear();
        }
        let samples = self.synth.render_frame(events);
        if let Err(e) = self.queue.queue_audio(&samples) {
            eprintln!("audio: SDL queue failed ({e}); continuing muted");
        }
    }

    fn reset(&mut self) {
        self.synth.reset();
        self.queue.clear();
    }
}

struct ConsoleCtx {
    list: Vec<ConsoleCart>,
    launcher: Vec<u8>,
    hd_boot: Option<Vec<u8>>,
    screen: ConsoleScreen,
    pending_hd: Option<usize>,
}

struct Runner {
    host: Host,
    title: String,
    fbw: usize,
    fbh: usize,
    presentation_rate: PresentationRate,
    presentation_override: Option<PresentationRate>,
    feed: Feed,
    keys: u32,
    pacer: SimulationPacer,
    fault: Option<Fault>,
    errored: bool,
    watcher: Option<Watcher>,
    console: Option<ConsoleCtx>,
    audio: Option<SdlAudio>,
    title_dirty: bool,
    release_inputs: bool,
    input_method: InputMethod,
    confirmation: Option<Confirmation>,
    input_profile: InputProfile,
    perf_enabled: bool,
    perf: PerfStats,
    perf_log_dir: Option<PathBuf>,
    perf_log: Option<PerfLog>,
    perf_log_error: bool,
}

impl Runner {
    fn stop_perf_log(&mut self) {
        if let Some(log) = self.perf_log.take() {
            match log.finish() {
                Ok(path) => eprintln!("sdl: performance log stopped: {}", path.display()),
                Err(error) => {
                    self.perf_log_error = true;
                    eprintln!("sdl: {error}");
                }
            }
        }
    }

    fn perf_action(&mut self, action: PerfChordAction) {
        match action {
            PerfChordAction::ToggleHud => {
                self.perf_enabled = !self.perf_enabled;
                if !self.perf_enabled {
                    self.stop_perf_log();
                    self.perf_log_error = false;
                }
                eprintln!(
                    "sdl: performance overlay {}",
                    if self.perf_enabled { "on" } else { "off" }
                );
            }
            PerfChordAction::ToggleLog if !self.perf_enabled => {
                eprintln!("sdl: performance logging requires the overlay");
            }
            PerfChordAction::ToggleLog if self.perf_log.is_some() => self.stop_perf_log(),
            PerfChordAction::ToggleLog => {
                self.perf_log_error = false;
                let Some(dir) = &self.perf_log_dir else {
                    self.perf_log_error = true;
                    eprintln!("sdl: performance logging has no directory; use --perf-log-dir");
                    return;
                };
                let now = Instant::now();
                match PerfLog::start(dir, now) {
                    Ok(log) => {
                        eprintln!("sdl: performance log started: {}", log.path().display());
                        self.perf.reset(now);
                        self.perf_log = Some(log);
                    }
                    Err(error) => {
                        self.perf_log_error = true;
                        eprintln!("sdl: {error}");
                    }
                }
            }
        }
    }

    fn in_launcher(&self) -> bool {
        self.console
            .as_ref()
            .is_none_or(|c| c.screen == ConsoleScreen::Launcher)
    }

    fn in_cart(&self) -> bool {
        self.console
            .as_ref()
            .is_some_and(|console| console.screen == ConsoleScreen::Cart)
    }

    fn open_confirmation(&mut self, action: PendingAction) {
        self.confirmation = Some(Confirmation::new(action));
        self.keys = 0;
        self.title_dirty = true;
        if let Some(audio) = &mut self.audio {
            audio.reset();
        }
    }

    fn close_confirmation(&mut self) {
        self.confirmation = None;
        self.keys = 0;
        self.pacer = SimulationPacer::new(Instant::now());
        self.title_dirty = true;
    }

    fn poll_reload(&mut self) -> bool {
        if self.confirmation.is_some() {
            return false;
        }
        let Some(watcher) = &mut self.watcher else {
            return false;
        };
        let Some(bytes) = watcher.poll() else {
            return false;
        };
        let mut host = match Host::new(&bytes, self.fbw as i32, self.fbh as i32) {
            Ok(host) => host,
            Err(e) => {
                eprintln!("watch: load error: {e} — keeping the old cart");
                return false;
            }
        };
        if let Err(fault) = host.start() {
            eprintln!(
                "watch: fault in start() ({}): {} — keeping the old cart",
                fault.kind, fault.msg
            );
            return false;
        }
        self.host = host;
        self.keys = 0;
        self.release_inputs = true;
        self.fault = None;
        self.pacer = SimulationPacer::new(Instant::now());
        if let Some(audio) = &mut self.audio {
            audio.reset();
        }
        eprintln!("watch: running (load #{})", watcher.reloads + 1);
        true
    }

    fn console_boot(
        &mut self,
        wasm: &[u8],
        system: bool,
        name: &str,
        display: DisplayProfile,
        input: InputProfile,
        presentation: PresentationRate,
        synthetic_metas: Option<Vec<calyx_core::SysCart>>,
    ) -> bool {
        let metas = synthetic_metas.unwrap_or_else(|| {
            self.console
                .as_ref()
                .map(|c| c.list.iter().map(|cart| cart.meta.clone()).collect())
                .unwrap_or_default()
        });
        let (fbw, fbh) = display.dimensions();
        let mut host = match if system {
            Host::new_system(wasm, fbw, fbh, metas)
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
        host.set_input_method(self.input_method);
        if let Err(fault) = host.start() {
            eprintln!(
                "console: {name}: fault in start() ({}): {} — staying put",
                fault.kind, fault.msg
            );
            self.errored = true;
            return false;
        }
        self.host = host;
        self.fbw = fbw as usize;
        self.fbh = fbh as usize;
        self.input_profile = input;
        self.presentation_rate = self.presentation_override.unwrap_or(presentation);
        self.keys = 0;
        self.release_inputs = true;
        self.fault = None;
        self.pacer = SimulationPacer::new(Instant::now());
        self.title = format!("calyx — {name}");
        self.title_dirty = true;
        if let Some(audio) = &mut self.audio {
            audio.reset();
        }
        true
    }

    fn console_return_to_launcher(&mut self) {
        let Some(console) = &self.console else {
            return;
        };
        if console.screen == ConsoleScreen::Launcher {
            return;
        }
        eprintln!("console: exit -> launcher");
        let wasm = console.launcher.clone();
        if self.console_boot(
            &wasm,
            true,
            "launcher",
            DisplayProfile::Classic,
            InputProfile::Classic,
            PresentationRate::Hz60,
            None,
        ) {
            if let Some(console) = &mut self.console {
                console.screen = ConsoleScreen::Launcher;
                console.pending_hd = None;
            }
        }
    }

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
                        DisplayProfile::Hd,
                        InputProfile::Classic,
                        PresentationRate::Hz60,
                        Some(vec![target_meta]),
                    ) {
                        if let Some(console) = &mut self.console {
                            console.screen = ConsoleScreen::HdBoot;
                            console.pending_hd = Some(target);
                        }
                    }
                    return;
                }
                match std::fs::read(&path) {
                    Ok(wasm) => {
                        eprintln!("console: launch {i} -> {name}");
                        if self.console_boot(
                            &wasm,
                            system,
                            &name,
                            display,
                            input,
                            presentation,
                            None,
                        ) {
                            if let Some(console) = &mut self.console {
                                console.screen = ConsoleScreen::Cart;
                                console.pending_hd = None;
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

    fn step_due(&mut self) -> bool {
        if self.fault.is_some() || self.confirmation.is_some() {
            return false;
        }
        let due = self.pacer.due(Instant::now());
        let mut redraw = false;
        for _ in 0..due {
            let frame = self.host.frames_run();
            self.host.set_input_method(self.input_method);
            let sim_started = Instant::now();
            let stepped = self
                .host
                .step_live((self.keys as i32) | self.feed.at(frame));
            self.perf.record_sim(sim_started.elapsed());
            match stepped {
                Ok(record) => {
                    if let Some(audio) = &mut self.audio {
                        audio.frame(&record.audio);
                    }
                    if self.console.is_some() {
                        let action = action_of(&record.sys);
                        if !matches!(action, SysAction::None) {
                            self.console_act(action);
                            redraw = true;
                            break;
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
                    self.fault = Some(fault);
                    redraw = true;
                    break;
                }
            }
        }
        redraw
    }
}

fn open_controller(
    subsystem: &sdl2::GameControllerSubsystem,
    controllers: &mut Vec<GameController>,
    index: u32,
) {
    if !subsystem.is_game_controller(index) {
        return;
    }
    match subsystem.open(index) {
        Ok(controller) => {
            let instance = controller.instance_id();
            if controllers.iter().any(|c| c.instance_id() == instance) {
                return;
            }
            eprintln!(
                "sdl: controller {} connected: {}",
                instance,
                controller.name()
            );
            controllers.push(controller);
        }
        Err(e) => eprintln!("sdl: controller {index} could not open: {e}"),
    }
}

fn load_controllers(
    subsystem: &sdl2::GameControllerSubsystem,
    mapping_db: Option<&Path>,
) -> Result<Vec<GameController>, String> {
    if let Some(path) = mapping_db {
        let loaded = subsystem
            .load_mappings(path)
            .map_err(|e| format!("controller mappings {}: {e}", path.display()))?;
        eprintln!(
            "sdl: loaded {loaded} controller mappings from {}",
            path.display()
        );
    }
    let mut controllers = Vec::new();
    for index in 0..subsystem.num_joysticks()? {
        open_controller(subsystem, &mut controllers, index);
    }
    Ok(controllers)
}

#[cfg(test)]
fn expand_argb8888(indexed: &[u8], palette: &[(u8, u8, u8)], out: &mut Vec<u8>) {
    if indexed.is_empty() {
        out.clear();
        return;
    }
    out.resize(indexed.len() * 4, 0);
    expand_argb8888_pitched(indexed, palette, out, indexed.len() * 4, indexed.len(), 1)
        .expect("packed expansion dimensions are exact");
}

fn expand_argb8888_pitched(
    indexed: &[u8],
    palette: &[(u8, u8, u8)],
    out: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
) -> Result<(), String> {
    let pixels = width
        .checked_mul(height)
        .ok_or_else(|| "SDL expansion dimensions overflow".to_string())?;
    let bytes = pitch
        .checked_mul(height)
        .ok_or_else(|| "SDL expansion pitch overflows".to_string())?;
    if pitch < width.saturating_mul(4) || indexed.len() < pixels || out.len() < bytes {
        return Err(format!(
            "SDL expansion buffer mismatch: indexed={} output={} pitch={pitch} size={width}x{height}",
            indexed.len(),
            out.len()
        ));
    }
    let mut lookup = [0xff00_0000u32.to_ne_bytes(); 256];
    for (slot, &(r, g, b)) in lookup.iter_mut().zip(palette) {
        let packed = 0xff00_0000 | (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b);
        *slot = packed.to_ne_bytes();
    }
    for (source, target) in indexed[..pixels]
        .chunks_exact(width)
        .zip(out[..bytes].chunks_exact_mut(pitch))
    {
        for (&index, pixel) in source.iter().zip(target[..width * 4].chunks_exact_mut(4)) {
            pixel.copy_from_slice(&lookup[index as usize]);
        }
    }
    Ok(())
}

fn expand_framebuffer(
    fb: &calyx_core::Framebuffer,
    palette: &[(u8, u8, u8)],
    out: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
) -> Result<(), String> {
    if !fb.true_color {
        return expand_argb8888_pitched(&fb.px, palette, out, pitch, width, height);
    }
    if width != fb.w as usize
        || height != fb.h as usize
        || pitch < width.saturating_mul(4)
        || out.len() < pitch.saturating_mul(height)
    {
        return Err("SDL RGBA buffer mismatch".into());
    }
    for y in 0..height {
        for x in 0..width {
            let (r, g, b) = fb.rgb_at(y * width + x, palette);
            let packed = 0xff000000u32 | (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b);
            out[y * pitch + x * 4..y * pitch + x * 4 + 4].copy_from_slice(&packed.to_ne_bytes());
        }
    }
    Ok(())
}

fn present_texture(canvas: &mut Canvas<Window>, texture: &Texture<'_>) -> Result<(), String> {
    canvas.clear();
    canvas
        .copy(texture, None, None)
        .map_err(|e| format!("SDL present: {e}"))?;
    canvas.present();
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_sdl(
    sdl: sdl2::Sdl,
    mut runner: Runner,
    fullscreen: bool,
    mapping_db: Option<PathBuf>,
) -> Result<bool, String> {
    let video = sdl.video()?;
    sdl2::hint::set("SDL_RENDER_SCALE_QUALITY", "0");
    let mut builder = video.window(
        &runner.title,
        (runner.fbw * 2) as u32,
        (runner.fbh * 2) as u32,
    );
    builder.position_centered().resizable();
    if fullscreen {
        builder.fullscreen_desktop();
    }
    let window = builder.build().map_err(|e| format!("SDL window: {e}"))?;
    let mut canvas = window
        .into_canvas()
        .build()
        .map_err(|e| format!("SDL renderer: {e}"))?;
    let renderer = canvas.info();
    eprintln!(
        "sdl: renderer {} max={}x{} formats={:?}",
        renderer.name,
        renderer.max_texture_width,
        renderer.max_texture_height,
        renderer.texture_formats
    );
    canvas
        .set_logical_size(runner.fbw as u32, runner.fbh as u32)
        .map_err(|e| format!("SDL logical size: {e}"))?;
    canvas
        .set_integer_scale(true)
        .map_err(|e| format!("SDL integer scale: {e}"))?;
    canvas.set_draw_color(Color::BLACK);

    let texture_creator = canvas.texture_creator();
    let mut texture = texture_creator
        .create_texture_streaming(
            PixelFormatEnum::ARGB8888,
            runner.fbw as u32,
            runner.fbh as u32,
        )
        .map_err(|e| format!("SDL framebuffer texture: {e}"))?;
    let controllers_api = sdl.game_controller()?;
    let mut controllers = load_controllers(&controllers_api, mapping_db.as_deref())?;
    let mut events = sdl.event_pump()?;
    let mut keyboard_keys = 0u32;
    let mut controller_button_keys = 0u32;
    let mut controller_stick_keys = HashMap::<u32, u32>::new();
    let mut redraw = true;
    let mut running = true;
    let mut suppress_until_release = false;
    let mut backspace_down = false;
    let mut escape_down = false;
    let mut controller_back_down = false;
    let mut controller_guide_down = false;
    let mut perf_chord = PerfChord::default();

    while running {
        for event in events.poll_iter() {
            match event {
                Event::Quit { .. } => running = false,
                Event::KeyDown {
                    keycode: Some(code),
                    repeat: false,
                    ..
                } => {
                    if let Some(button) = perf_key(code) {
                        if let Some(action) = perf_chord.set(button, true) {
                            runner.perf_action(action);
                            keyboard_keys = 0;
                            controller_button_keys = 0;
                            suppress_until_release = true;
                            redraw = true;
                            continue;
                        }
                    }
                    if code == Keycode::Backspace {
                        backspace_down = true;
                    }
                    if code == Keycode::Escape {
                        escape_down = true;
                    }
                    if runner.confirmation.is_some() && suppress_until_release {
                        continue;
                    }
                    if let Some(mut prompt) = runner.confirmation {
                        match code {
                            Keycode::Left | Keycode::Right | Keycode::Tab => {
                                prompt.toggle();
                                runner.confirmation = Some(prompt);
                                redraw = true;
                            }
                            Keycode::Return | Keycode::Z => {
                                let accepted = prompt.accepted();
                                runner.close_confirmation();
                                suppress_until_release = true;
                                match accepted {
                                    Some(PendingAction::Home) => {
                                        runner.console_return_to_launcher()
                                    }
                                    Some(PendingAction::Quit) => running = false,
                                    None => {}
                                }
                                redraw = true;
                            }
                            Keycode::Escape | Keycode::X => {
                                runner.close_confirmation();
                                suppress_until_release = true;
                                redraw = true;
                            }
                            _ => {}
                        }
                        continue;
                    }
                    match key_shell_action(code, runner.in_launcher()) {
                        Some(ShellAction::Quit) => {
                            if runner.in_cart() {
                                runner.open_confirmation(PendingAction::Quit);
                                suppress_until_release = true;
                                redraw = true;
                            } else {
                                running = false;
                            }
                        }
                        Some(ShellAction::Home) => {
                            if runner.in_cart() {
                                runner.input_method = InputMethod::Keyboard;
                                runner.open_confirmation(PendingAction::Home);
                                suppress_until_release = true;
                                redraw = true;
                            }
                        }
                        None => {
                            let bit = if runner.input_profile == InputProfile::Extended {
                                extended_key_bit(code)
                            } else {
                                key_bit(code)
                            };
                            if let Some(bit) = bit {
                                runner.input_method = InputMethod::Keyboard;
                                keyboard_keys |= 1 << bit;
                            }
                        }
                    }
                }
                Event::KeyUp {
                    keycode: Some(code),
                    repeat: false,
                    ..
                } => {
                    if let Some(button) = perf_key(code) {
                        perf_chord.set(button, false);
                    }
                    if code == Keycode::Backspace {
                        backspace_down = false;
                    }
                    if code == Keycode::Escape {
                        escape_down = false;
                    }
                    let bit = if runner.input_profile == InputProfile::Extended {
                        extended_key_bit(code)
                    } else {
                        key_bit(code)
                    };
                    if let Some(bit) = bit {
                        keyboard_keys &= !(1 << bit);
                    }
                }
                Event::ControllerButtonDown { button, .. } => {
                    if let Some(chord_button) = perf_button(button) {
                        if let Some(action) = perf_chord.set(chord_button, true) {
                            runner.perf_action(action);
                            keyboard_keys = 0;
                            controller_button_keys = 0;
                            suppress_until_release = true;
                            redraw = true;
                            continue;
                        }
                    }
                    if button == Button::Back {
                        controller_back_down = true;
                    }
                    if button == Button::Guide {
                        controller_guide_down = true;
                    }
                    if runner.confirmation.is_some() && suppress_until_release {
                        continue;
                    }
                    if let Some(mut prompt) = runner.confirmation {
                        match button {
                            Button::DPadLeft | Button::DPadRight => {
                                prompt.toggle();
                                runner.confirmation = Some(prompt);
                                redraw = true;
                            }
                            Button::A => {
                                let accepted = prompt.accepted();
                                runner.close_confirmation();
                                suppress_until_release = true;
                                match accepted {
                                    Some(PendingAction::Home) => {
                                        runner.console_return_to_launcher()
                                    }
                                    Some(PendingAction::Quit) => running = false,
                                    None => {}
                                }
                                redraw = true;
                            }
                            Button::B => {
                                runner.close_confirmation();
                                suppress_until_release = true;
                                redraw = true;
                            }
                            _ => {}
                        }
                        continue;
                    }
                    match controller_shell_action(button, runner.in_launcher()) {
                        Some(ShellAction::Quit) => {
                            if runner.in_cart() {
                                runner.input_method = InputMethod::Controller;
                                runner.open_confirmation(PendingAction::Quit);
                                suppress_until_release = true;
                                redraw = true;
                            } else {
                                running = false;
                            }
                        }
                        Some(ShellAction::Home) => {
                            if runner.in_cart() {
                                runner.input_method = InputMethod::Controller;
                                runner.open_confirmation(PendingAction::Home);
                                suppress_until_release = true;
                                redraw = true;
                            }
                        }
                        None => {
                            let bit = if runner.input_profile == InputProfile::Extended {
                                extended_controller_bit(button)
                            } else {
                                controller_bit(button)
                            };
                            if let Some(bit) = bit {
                                runner.input_method = InputMethod::Controller;
                                controller_button_keys |= 1 << bit;
                            }
                        }
                    }
                }
                Event::ControllerButtonUp { button, .. } => {
                    if let Some(chord_button) = perf_button(button) {
                        perf_chord.set(chord_button, false);
                    }
                    if button == Button::Back {
                        controller_back_down = false;
                    }
                    if button == Button::Guide {
                        controller_guide_down = false;
                    }
                    let bit = if runner.input_profile == InputProfile::Extended {
                        extended_controller_bit(button)
                    } else {
                        controller_bit(button)
                    };
                    if let Some(bit) = bit {
                        controller_button_keys &= !(1 << bit);
                    }
                }
                Event::ControllerAxisMotion {
                    which, axis, value, ..
                } => {
                    let previous = controller_stick_keys.get(&which).copied().unwrap_or(0);
                    let next = stick_axis_bits(axis, value, previous);
                    if next != previous {
                        if next & !previous != 0 {
                            runner.input_method = InputMethod::Controller;
                        }
                        if next == 0 {
                            controller_stick_keys.remove(&which);
                        } else {
                            controller_stick_keys.insert(which, next);
                        }
                    }
                }
                Event::ControllerDeviceAdded { which, .. } => {
                    open_controller(&controllers_api, &mut controllers, which);
                }
                Event::ControllerDeviceRemoved { which, .. } => {
                    controllers.retain(|controller| controller.instance_id() != which);
                    controller_button_keys = 0;
                    controller_stick_keys.remove(&which);
                    eprintln!("sdl: controller {which} disconnected");
                }
                _ => {}
            }
        }

        redraw |= runner.poll_reload();
        if runner.release_inputs {
            keyboard_keys = 0;
            controller_button_keys = 0;
            controller_stick_keys.clear();
            runner.release_inputs = false;
        }
        let stick_keys = controller_stick_keys
            .values()
            .copied()
            .fold(0, |keys, stick| keys | stick);
        let physical_keys = keyboard_keys | controller_button_keys | stick_keys;
        if suppress_until_release {
            runner.keys = 0;
            if physical_keys == 0
                && !backspace_down
                && !escape_down
                && !controller_back_down
                && !controller_guide_down
                && !perf_chord.any_down()
            {
                suppress_until_release = false;
            }
        } else {
            runner.keys = physical_keys;
        }
        redraw |= runner.step_due();
        let texture_size = texture.query();
        if texture_size.width != runner.fbw as u32 || texture_size.height != runner.fbh as u32 {
            canvas
                .set_logical_size(runner.fbw as u32, runner.fbh as u32)
                .map_err(|e| format!("SDL logical size: {e}"))?;
            texture = texture_creator
                .create_texture_streaming(
                    PixelFormatEnum::ARGB8888,
                    runner.fbw as u32,
                    runner.fbh as u32,
                )
                .map_err(|e| format!("SDL framebuffer texture: {e}"))?;
            redraw = true;
        }
        if runner.title_dirty {
            let title = runner.confirmation.map_or_else(
                || runner.title.clone(),
                |prompt| format!("{} — {}", runner.title, prompt.question()),
            );
            canvas
                .window_mut()
                .set_title(&title)
                .map_err(|e| format!("SDL window title: {e}"))?;
            runner.title_dirty = false;
        }
        if redraw {
            let rgb_started = Instant::now();
            texture
                .with_lock(None, |pixels, pitch| {
                    expand_framebuffer(
                        runner.host.fb(),
                        runner.host.palette_rgb(),
                        pixels,
                        pitch,
                        runner.fbw,
                        runner.fbh,
                    )?;
                    if let Some(prompt) = runner.confirmation {
                        draw_confirmation(prompt, pixels, pitch, runner.fbw, runner.fbh);
                    }
                    if runner.perf_enabled {
                        draw_perf(
                            &runner.perf,
                            runner.perf_log.is_some(),
                            runner.perf_log_error,
                            pixels,
                            pitch,
                            runner.fbw,
                            runner.fbh,
                        );
                    }
                    Ok::<(), String>(())
                })
                .map_err(|e| format!("SDL texture lock: {e}"))??;
            runner.perf.record_rgb(rgb_started.elapsed());
            let sdl_started = Instant::now();
            present_texture(&mut canvas, &texture)?;
            runner.perf.record_sdl(sdl_started.elapsed());
            let now = Instant::now();
            if let Some(sample) = runner.perf.record_present(now) {
                let write = runner
                    .perf_log
                    .as_mut()
                    .map(|log| log.record(now, &runner.title, runner.fbw, runner.fbh, &sample));
                if let Some(Err(error)) = write {
                    runner.perf_log.take();
                    runner.perf_log_error = true;
                    eprintln!("sdl: {error}; performance logging stopped");
                }
            }
            redraw = false;
        }
        std::thread::sleep(Duration::from_millis(1));
    }

    runner.stop_perf_log();
    Ok(!runner.errored)
}

fn duration_summary(samples: &[Duration]) -> serde_json::Value {
    if samples.is_empty() {
        return serde_json::json!({"mean_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0});
    }
    let mut ns: Vec<u128> = samples.iter().map(Duration::as_nanos).collect();
    ns.sort_unstable();
    let total: u128 = ns.iter().sum();
    let p95_at = ((ns.len() * 95).div_ceil(100)).saturating_sub(1);
    serde_json::json!({
        "mean_ms": total as f64 / ns.len() as f64 / 1_000_000.0,
        "p95_ms": ns[p95_at] as f64 / 1_000_000.0,
        "max_ms": ns[ns.len() - 1] as f64 / 1_000_000.0,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn benchmark(
    wasm: &[u8],
    cart_name: &str,
    w: i32,
    h: i32,
    warmup: u32,
    frames: u32,
    feed: Feed,
    out: Option<&Path>,
) -> Result<bool, String> {
    // This command deliberately owns a headless SDL process. The interactive
    // presenter remains controlled by the caller's normal platform driver.
    std::env::set_var("SDL_VIDEODRIVER", "dummy");
    std::env::set_var("SDL_AUDIODRIVER", "dummy");
    std::env::set_var("SDL_RENDER_DRIVER", "software");

    let mut host = Host::new(wasm, w, h).map_err(|e| format!("{e}"))?;
    host.start()
        .map_err(|fault| format!("fault in start() ({}): {}", fault.kind, fault.msg))?;
    let sdl = sdl2::init()?;
    let video = sdl.video()?;
    let window = video
        .window("calyx SDL benchmark", w as u32, h as u32)
        .hidden()
        .build()
        .map_err(|e| format!("SDL benchmark window: {e}"))?;
    let mut canvas = window
        .into_canvas()
        .software()
        .build()
        .map_err(|e| format!("SDL benchmark renderer: {e}"))?;
    let renderer = canvas.info().name;
    let texture_creator = canvas.texture_creator();
    let mut texture = texture_creator
        .create_texture_streaming(PixelFormatEnum::ARGB8888, w as u32, h as u32)
        .map_err(|e| format!("SDL benchmark texture: {e}"))?;
    let mut sim_samples = Vec::with_capacity(frames as usize);
    let mut rgb_samples = Vec::with_capacity(frames as usize);
    let mut sdl_samples = Vec::with_capacity(frames as usize);
    let mut measured_started = None;

    for frame in 0..warmup.saturating_add(frames) {
        let measured = frame >= warmup;
        if frame == warmup {
            measured_started = Some(Instant::now());
        }
        let sim_started = Instant::now();
        host.step_live(feed.at(host.frames_run()))
            .map_err(|fault| format!("fault at f{} ({}): {}", fault.f, fault.kind, fault.msg))?;
        if measured {
            sim_samples.push(sim_started.elapsed());
        }

        let rgb_started = Instant::now();
        texture
            .with_lock(None, |pixels, pitch| {
                expand_framebuffer(
                    host.fb(),
                    host.palette_rgb(),
                    pixels,
                    pitch,
                    w as usize,
                    h as usize,
                )
            })
            .map_err(|e| format!("SDL benchmark texture lock: {e}"))??;
        if measured {
            rgb_samples.push(rgb_started.elapsed());
        }

        let sdl_started = Instant::now();
        present_texture(&mut canvas, &texture)?;
        if measured {
            sdl_samples.push(sdl_started.elapsed());
        }
    }
    let final_hash = host.fb().hash();
    let elapsed = measured_started
        .expect("benchmark requires at least one measured frame")
        .elapsed();
    let report = serde_json::json!({
        "schema": 1,
        "kind": "calyx-sdl-headless-benchmark",
        "cart": cart_name,
        "video_driver": video.current_video_driver(),
        "renderer": renderer,
        "width": w,
        "height": h,
        "warmup_frames": warmup,
        "measured_frames": frames,
        "elapsed_ms": elapsed.as_secs_f64() * 1000.0,
        "frames_per_second": f64::from(frames) / elapsed.as_secs_f64().max(f64::EPSILON),
        "sim": duration_summary(&sim_samples),
        "rgb": duration_summary(&rgb_samples),
        "sdl": duration_summary(&sdl_samples),
        "final_hash": format!("{final_hash:016x}"),
    });
    let text = serde_json::to_string_pretty(&report).map_err(|e| format!("benchmark JSON: {e}"))?;
    if let Some(path) = out {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create benchmark output {}: {e}", parent.display()))?;
        }
        std::fs::write(path, format!("{text}\n"))
            .map_err(|e| format!("write benchmark output {}: {e}", path.display()))?;
    }
    println!("{text}");
    Ok(true)
}

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
    fullscreen: bool,
    mapping_db: Option<PathBuf>,
    perf_log_dir: Option<PathBuf>,
) -> Result<bool, String> {
    let mut host = Host::new(wasm, w, h).map_err(|e| format!("{e}"))?;
    if let Err(fault) = host.start() {
        return Err(format!("fault in start() ({}): {}", fault.kind, fault.msg));
    }
    let sdl = sdl2::init()?;
    let audio = if audio_enabled {
        match SdlAudio::open(&sdl) {
            Ok(audio) => Some(audio),
            Err(e) => {
                eprintln!("audio: SDL unavailable ({e}); continuing muted");
                None
            }
        }
    } else {
        None
    };
    let runner = Runner {
        host,
        title: format!("calyx — {cart_name}"),
        fbw: w as usize,
        fbh: h as usize,
        presentation_rate,
        presentation_override: Some(presentation_rate),
        feed,
        keys: 0,
        pacer: SimulationPacer::new(Instant::now()),
        fault: None,
        errored: false,
        watcher,
        console: None,
        audio,
        title_dirty: false,
        release_inputs: false,
        input_method: InputMethod::Keyboard,
        confirmation: None,
        input_profile: InputProfile::Classic,
        perf_enabled: false,
        perf: PerfStats::new(Instant::now()),
        perf_log_dir,
        perf_log: None,
        perf_log_error: false,
    };
    run_sdl(sdl, runner, fullscreen, mapping_db)
}

// Console startup options are presenter configuration, kept explicit at this boundary.
#[allow(clippy::too_many_arguments)]
pub fn play_console(
    dir: &Path,
    _w: i32,
    _h: i32,
    presentation_override: Option<PresentationRate>,
    audio_enabled: bool,
    fullscreen: bool,
    mapping_db: Option<PathBuf>,
    product_label: &str,
    perf_log_dir: Option<PathBuf>,
) -> Result<bool, String> {
    let (list, roles) = scan_carts(dir)?;
    let (w, h) = DisplayProfile::Classic.dimensions();
    let metas: Vec<_> = list.iter().map(|cart| cart.meta.clone()).collect();
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
    let sdl = sdl2::init()?;
    let audio = if audio_enabled {
        match SdlAudio::open(&sdl) {
            Ok(audio) => Some(audio),
            Err(e) => {
                eprintln!("audio: SDL unavailable ({e}); continuing muted");
                None
            }
        }
    } else {
        None
    };
    let runner = Runner {
        host,
        title: format!("{product_label} — {name}"),
        fbw: w as usize,
        fbh: h as usize,
        presentation_rate: presentation_override.unwrap_or(PresentationRate::Hz60),
        presentation_override,
        feed: Feed::empty(),
        keys: 0,
        pacer: SimulationPacer::new(Instant::now()),
        fault: None,
        errored: false,
        watcher: None,
        console: Some(ConsoleCtx {
            list,
            launcher: roles.launcher,
            hd_boot: roles.hd_boot,
            screen,
            pending_hd: None,
        }),
        audio,
        title_dirty: false,
        release_inputs: false,
        input_method: InputMethod::Keyboard,
        confirmation: None,
        input_profile: InputProfile::Classic,
        perf_enabled: false,
        perf: PerfStats::new(Instant::now()),
        perf_log_dir,
        perf_log: None,
        perf_log_error: false,
    };
    run_sdl(sdl, runner, fullscreen, mapping_db)
}

#[cfg(test)]
mod tests {
    #[test]
    fn rgba_expansion_keeps_literal_colors_and_pitch() {
        let mut fb = calyx_core::Framebuffer::new(2, 2);
        fb.set_color_mode(true);
        fb.rgba_cls(0x12345600);
        let mut out = [99; 24];
        super::expand_framebuffer(&fb, &[], &mut out, 12, 2, 2).unwrap();
        for at in [0, 4, 12, 16] {
            assert_eq!(&out[at..at + 4], &0xff123456u32.to_ne_bytes());
        }
        assert_eq!(&out[8..12], &[99; 4]);
        assert_eq!(&out[20..24], &[99; 4]);
    }

    use super::*;

    #[test]
    fn keyboard_matches_the_seven_button_console_face() {
        assert_eq!(key_bit(Keycode::Up), Some(0));
        assert_eq!(key_bit(Keycode::W), Some(0));
        assert_eq!(key_bit(Keycode::Down), Some(1));
        assert_eq!(key_bit(Keycode::Left), Some(2));
        assert_eq!(key_bit(Keycode::Right), Some(3));
        assert_eq!(key_bit(Keycode::Z), Some(4));
        assert_eq!(key_bit(Keycode::X), Some(5));
        assert_eq!(key_bit(Keycode::Return), Some(6));
        assert_eq!(key_bit(Keycode::Space), None);
    }

    #[test]
    fn controller_maps_only_the_seven_button_console_face() {
        assert_eq!(controller_bit(Button::DPadUp), Some(0));
        assert_eq!(controller_bit(Button::DPadDown), Some(1));
        assert_eq!(controller_bit(Button::DPadLeft), Some(2));
        assert_eq!(controller_bit(Button::DPadRight), Some(3));
        assert_eq!(controller_bit(Button::A), Some(4));
        assert_eq!(controller_bit(Button::B), Some(5));
        assert_eq!(controller_bit(Button::Start), Some(6));
        assert_eq!(controller_bit(Button::X), None);
        assert_eq!(controller_bit(Button::LeftShoulder), None);
    }

    #[test]
    fn rgb_expansion_uses_exact_palette_bytes_and_black_for_unknown_indices() {
        let mut out = Vec::new();
        expand_argb8888(&[0, 1, 2, 255], &[(1, 2, 3), (250, 128, 64)], &mut out);
        let expected = [
            0xff01_0203u32,
            0xfffa_8040u32,
            0xff00_0000u32,
            0xff00_0000u32,
        ];
        let expected: Vec<u8> = expected.into_iter().flat_map(u32::to_ne_bytes).collect();
        assert_eq!(out, expected);
    }

    #[test]
    fn pitched_argb8888_expansion_preserves_row_padding() {
        let indexed = [0, 1, 1, 0];
        let mut out = vec![0x5a; 24];
        expand_argb8888_pitched(&indexed, &[(1, 2, 3), (4, 5, 6)], &mut out, 12, 2, 2).unwrap();
        assert_eq!(&out[8..12], &[0x5a; 4]);
        assert_eq!(&out[20..24], &[0x5a; 4]);
        assert_eq!(&out[0..4], &0xff01_0203u32.to_ne_bytes());
        assert_eq!(&out[12..16], &0xff04_0506u32.to_ne_bytes());
    }

    #[test]
    fn left_stick_maps_to_directions_without_clobbering_the_other_axis() {
        let left = stick_axis_bits(Axis::LeftX, -STICK_PRESS_THRESHOLD, 0);
        assert_eq!(left, 1 << 2);
        let up_left = stick_axis_bits(Axis::LeftY, -STICK_PRESS_THRESHOLD, left);
        assert_eq!(up_left, (1 << 0) | (1 << 2));
        assert_eq!(stick_axis_bits(Axis::RightX, i16::MAX, up_left), up_left);
    }

    #[test]
    fn left_stick_uses_hysteresis_around_center() {
        assert_eq!(
            stick_axis_bits(Axis::LeftX, STICK_PRESS_THRESHOLD - 1, 0),
            0
        );
        let right = stick_axis_bits(Axis::LeftX, STICK_PRESS_THRESHOLD, 0);
        assert_eq!(right, 1 << 3);
        assert_eq!(
            stick_axis_bits(Axis::LeftX, STICK_RELEASE_THRESHOLD + 1, right),
            right
        );
        assert_eq!(
            stick_axis_bits(Axis::LeftX, STICK_RELEASE_THRESHOLD, right),
            0
        );
    }

    #[test]
    fn controller_back_goes_home_and_guide_quits() {
        assert_eq!(
            controller_shell_action(Button::Back, false),
            Some(ShellAction::Home)
        );
        assert_eq!(controller_shell_action(Button::Back, true), None);
        assert_eq!(
            controller_shell_action(Button::Guide, false),
            Some(ShellAction::Quit)
        );
        assert_eq!(
            controller_shell_action(Button::Guide, true),
            Some(ShellAction::Quit)
        );
    }
}
