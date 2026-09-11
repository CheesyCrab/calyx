//! The cart host — wasmtime loader, the ABI §4 imports, and the headless
//! run loop that produces verified state (ABI §6a).
//!
//! This is the presenter-independent console: it owns the framebuffer,
//! palette, input, and the per-frame event stream (traces + audio events),
//! and hands back a [`RunReport`] with the `run_hash` gate. Where pixels go
//! afterward is not this crate's concern (that is the CLI's presenters).

use wasmtime::*;

use crate::font::{self, draw_text, Font};
use crate::framebuffer::Framebuffer;
use crate::hash::{hex16, Fnv};
use crate::input::{self, Feed, InputMethod, SysCart};
use crate::palette::Palette;

/// A `tone` request, recorded as a verified event (ABI §4 Audio / §6a).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioEvent {
    pub freq: i32,
    pub dur: i32,
    pub vol: i32,
    pub flags: i32,
}

/// A `calyx.sys` request, recorded as a verified event in privileged runs
/// (ABI §4b/§6a v1.1) — launch/exit are intent, like `tone`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SysEvent {
    Launch(i32),
    Exit,
}

/// A run that ended in a trap/abort (ABI §6a). A faulted run never matches
/// a golden; `msg` is informational and never compared.
#[derive(Clone, Debug)]
pub struct Fault {
    pub f: i32,
    pub kind: String, // "trap" | "abort"
    pub msg: String,
}

/// Per-frame verified record (the `frames.jsonl` row, ABI §6a).
#[derive(Clone, Debug)]
pub struct FrameRecord {
    pub f: i32,
    pub hash: u64,
    pub btn: Vec<String>,
    pub audio: Vec<AudioEvent>,
    pub trace: Vec<String>,
    /// `calyx.sys` events (v1.1) — only ever non-empty in privileged
    /// runs; serialized only there (the additive-bump guarantee).
    pub sys: Vec<SysEvent>,
}

/// Per-frame events returned to an interactive presenter. Unlike
/// [`FrameRecord`], this deliberately has no framebuffer hash or decoded
/// input names: live play presents output but does not verify it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveFrame {
    pub f: i32,
    pub audio: Vec<AudioEvent>,
    pub trace: Vec<String>,
    pub sys: Vec<SysEvent>,
}

/// The full verified outcome of a headless run.
pub struct RunReport {
    pub cart: String,
    pub w: i32,
    pub h: i32,
    pub palette_id: String,
    pub true_color: bool,
    pub frames_run: i32,
    pub run_hash: u64,
    pub final_hash: u64,
    pub frames: Vec<FrameRecord>,
    pub fault: Option<Fault>,
    pub input_label: String,
    /// True for a privileged (`calyx.sys`-linked) run — the dump then
    /// carries the `sys` key on every row (ABI §6a v1.1).
    pub system: bool,
}

impl RunReport {
    pub fn run_hex(&self) -> String {
        hex16(self.run_hash)
    }
    pub fn final_hex(&self) -> String {
        hex16(self.final_hash)
    }
    /// Distinct per-frame hashes — the anti-vacuous-golden witness (ABI §6a).
    pub fn distinct_frame_hashes(&self) -> usize {
        use std::collections::HashSet;
        self.frames
            .iter()
            .map(|fr| fr.hash)
            .collect::<HashSet<_>>()
            .len()
    }
}

/// What to run: frame count, scripted feed, and the framebuffer profile.
pub struct RunConfig {
    pub frames: i32,
    pub feed: Feed,
    pub w: i32,
    pub h: i32,
    pub input_label: String,
    /// Link the cart against `calyx.sys` (ABI §4b) — the runtime's
    /// *choice*, which is the whole privilege model. The scripted cart
    /// list comes from the feed's object form.
    pub system: bool,
}

impl RunConfig {
    /// The default profile (320×240), no input.
    pub fn new(frames: i32) -> Self {
        RunConfig {
            frames,
            feed: Feed::empty(),
            w: 320,
            h: 240,
            input_label: "(none)".to_string(),
            system: false,
        }
    }
    pub fn with_feed(mut self, feed: Feed, label: impl Into<String>) -> Self {
        self.feed = feed;
        self.input_label = label.into();
        self
    }
}

/// A presenter: fed the indexed framebuffer (and its verified record) each
/// frame, it puts them somewhere — terminal, PNG, window (README, "verify
/// intent, present output"). Sinks are dumb consumers on the verified side;
/// they never change what the run hashes. All hooks default to no-ops.
pub trait FrameSink {
    /// Called once before frame 0, with the run's fixed profile and palette.
    fn begin(&mut self, _w: i32, _h: i32, _palette_rgb: &[(u8, u8, u8)]) {}
    /// Called after each successful frame, with that frame's pixels + record.
    fn frame(&mut self, _fb: &Framebuffer, _rec: &FrameRecord) {}
    /// Called once after the run (faulted or complete).
    fn end(&mut self, _report: &RunReport) {}
}

/// The no-op sink — a headless run that presents nowhere.
pub struct NoSink;
impl FrameSink for NoSink {}

/// A cart that could not be loaded/instantiated — distinct from a fault,
/// which is a verified in-run trap.
#[derive(Debug)]
pub struct LoadError(pub String);

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for LoadError {}

// ── Host state behind the ABI (the cart never sees this) ───────────────
struct State {
    fb: Framebuffer,
    palette: Palette,
    font: &'static Font,
    frame: i32,
    btn: i32,
    in_start: bool,
    color_selected: bool,
    traces: Vec<String>,
    audio: Vec<AudioEvent>,
    abort_msg: Option<String>,
    /// The installed-cart list a privileged cart sees (ABI §4b); empty
    /// and unreachable for normal carts (the module isn't linked).
    sys_carts: Vec<SysCart>,
    input_method: InputMethod,
    sys: Vec<SysEvent>,
}

/// Build a host trap error.
fn trap(msg: impl std::fmt::Display) -> Error {
    Error::msg(msg.to_string())
}

/// Copy `bytes` into the cart's exported `memory` at `ptr`, validated
/// against its bounds. An out-of-range write traps immediately (ABI §4
/// Memory safety) — never a partial write.
fn write_mem(caller: &mut Caller<'_, State>, ptr: i32, bytes: &[u8]) -> Result<(), Error> {
    if ptr < 0 {
        return Err(trap(format!("negative ptr ({ptr})")));
    }
    let mem = caller
        .get_export("memory")
        .and_then(|e| e.into_memory())
        .ok_or_else(|| trap("cart has no exported memory"))?;
    let data = mem.data_mut(caller);
    let start = ptr as usize;
    let end = start
        .checked_add(bytes.len())
        .ok_or_else(|| trap("ptr+len overflow"))?;
    if end > data.len() {
        return Err(trap(format!(
            "memory write {start}..{end} out of bounds (len {})",
            data.len()
        )));
    }
    data[start..end].copy_from_slice(bytes);
    Ok(())
}

/// Copy `len` bytes from the cart's exported `memory` at `ptr`, validated
/// against its bounds. An out-of-range read traps immediately (ABI §4
/// Memory safety) — never a partial read.
fn read_mem(caller: &mut Caller<'_, State>, ptr: i32, len: i32) -> Result<Vec<u8>, Error> {
    if len < 0 {
        return Err(trap("negative length"));
    }
    read_mem_size(caller, ptr, len as usize)
}

fn read_mem_size(caller: &mut Caller<'_, State>, ptr: i32, len: usize) -> Result<Vec<u8>, Error> {
    if len > i32::MAX as usize {
        return Err(trap("source byte count exceeds 2147483647"));
    }
    if ptr < 0 {
        return Err(trap(format!("negative ptr/len ({ptr}, {len})")));
    }
    let mem = caller
        .get_export("memory")
        .and_then(|e| e.into_memory())
        .ok_or_else(|| trap("cart has no exported memory"))?;
    let data = mem.data(&caller);
    let start = ptr as usize;
    let end = start
        .checked_add(len)
        .ok_or_else(|| trap("ptr+len overflow"))?;
    if end > data.len() {
        return Err(trap(format!(
            "memory read {start}..{end} out of bounds (len {})",
            data.len()
        )));
    }
    Ok(data[start..end].to_vec())
}

fn register_imports(linker: &mut Linker<State>) -> Result<(), Error> {
    // ── Frame / device ─────────────────────────────────────────────────
    linker.func_wrap("calyx", "frame", |c: Caller<'_, State>| c.data().frame)?;
    linker.func_wrap("calyx", "width", |c: Caller<'_, State>| c.data().fb.w)?;
    linker.func_wrap("calyx", "height", |c: Caller<'_, State>| c.data().fb.h)?;
    linker.func_wrap("calyx", "btn", |c: Caller<'_, State>| c.data().btn)?;

    // ── Drawing ─────────────────────────────────────────────────────────
    linker.func_wrap("calyx", "cls", |mut c: Caller<'_, State>, idx: i32| {
        c.data_mut().fb.cls(idx as u8);
    })?;
    linker.func_wrap(
        "calyx",
        "pixel",
        |mut c: Caller<'_, State>, x: i32, y: i32, idx: i32| {
            c.data_mut().fb.set(x, y, idx as u8);
        },
    )?;
    linker.func_wrap(
        "calyx",
        "rect",
        |mut c: Caller<'_, State>, x: i32, y: i32, w: i32, h: i32, idx: i32| {
            c.data_mut().fb.rect(x, y, w, h, idx as u8);
        },
    )?;
    linker.func_wrap(
        "calyx",
        "hline",
        |mut c: Caller<'_, State>, x: i32, y: i32, w: i32, idx: i32| {
            c.data_mut().fb.hline(x, y, w, idx as u8);
        },
    )?;
    linker.func_wrap(
        "calyx",
        "vline",
        |mut c: Caller<'_, State>, x: i32, y: i32, h: i32, idx: i32| {
            c.data_mut().fb.vline(x, y, h, idx as u8);
        },
    )?;
    linker.func_wrap(
        "calyx",
        "text",
        |mut c: Caller<'_, State>,
         x: i32,
         y: i32,
         ptr: i32,
         len: i32,
         idx: i32,
         scale: i32|
         -> Result<(), Error> {
            let bytes = read_mem(&mut c, ptr, len)?;
            let st = c.data_mut();
            let font = st.font;
            draw_text(&mut st.fb, font, x, y, &bytes, idx as u8, scale);
            Ok(())
        },
    )?;
    linker.func_wrap(
        "calyx",
        "blit",
        |mut c: Caller<'_, State>,
         ptr: i32,
         sw: i32,
         sh: i32,
         x: i32,
         y: i32,
         dw: i32,
         dh: i32,
         flags: i32|
         -> Result<(), Error> {
            if sw < 0 || sh < 0 {
                return Err(trap(format!("blit negative source size ({sw}x{sh})")));
            }
            let count = (sw as usize)
                .checked_mul(sh as usize)
                .ok_or_else(|| trap("source size overflow"))?;
            let bytes = read_mem_size(&mut c, ptr, count)?;
            c.data_mut().fb.blit(&bytes, sw, sh, x, y, dw, dh, flags);
            Ok(())
        },
    )?;

    linker.func_wrap(
        "calyx",
        "set_color_mode",
        |mut c: Caller<'_, State>, mode: i32| -> Result<(), Error> {
            let st = c.data_mut();
            if !st.in_start || st.color_selected {
                return Err(trap("set_color_mode requires start(), once"));
            }
            if !(0..=1).contains(&mode) {
                return Err(trap("invalid color mode"));
            }
            st.color_selected = true;
            st.fb.set_color_mode(mode == 1);
            Ok(())
        },
    )?;
    linker.func_wrap(
        "calyx",
        "clip",
        |mut c: Caller<'_, State>, x: i32, y: i32, w: i32, h: i32| {
            c.data_mut().fb.clip(x, y, w, h);
        },
    )?;
    linker.func_wrap("calyx", "clip_reset", |mut c: Caller<'_, State>| {
        c.data_mut().fb.clip_reset();
    })?;
    linker.func_wrap(
        "calyx",
        "rgba_cls",
        |mut c: Caller<'_, State>, rgba: i32| -> Result<(), Error> {
            if !c.data().fb.true_color {
                return Err(trap("RGBA drawing requires true color"));
            }
            c.data_mut().fb.rgba_cls(rgba as u32);
            Ok(())
        },
    )?;
    linker.func_wrap(
        "calyx",
        "rgba_rect",
        |mut c: Caller<'_, State>,
         x: i32,
         y: i32,
         w: i32,
         h: i32,
         rgba: i32|
         -> Result<(), Error> {
            if !c.data().fb.true_color {
                return Err(trap("RGBA drawing requires true color"));
            }
            c.data_mut().fb.rgba_rect(x, y, w, h, rgba as u32);
            Ok(())
        },
    )?;
    linker.func_wrap(
        "calyx",
        "rgba_text",
        |mut c: Caller<'_, State>,
         x: i32,
         y: i32,
         ptr: i32,
         len: i32,
         rgba: i32,
         scale: i32|
         -> Result<(), Error> {
            if !c.data().fb.true_color {
                return Err(trap("RGBA drawing requires true color"));
            }
            let bytes = read_mem(&mut c, ptr, len)?;
            let st = c.data_mut();
            font::draw_rgba_text(&mut st.fb, st.font, x, y, &bytes, rgba as u32, scale);
            Ok(())
        },
    )?;
    linker.func_wrap(
        "calyx",
        "blit_region",
        |mut c: Caller<'_, State>,
         ptr: i32,
         sw: i32,
         sh: i32,
         sx: i32,
         sy: i32,
         rw: i32,
         rh: i32,
         x: i32,
         y: i32,
         dw: i32,
         dh: i32,
         flags: i32,
         tint: i32,
         opacity: i32|
         -> Result<(), Error> {
            if [sw, sh, sx, sy, rw, rh].iter().any(|&n| n < 0)
                || i64::from(sx) + i64::from(rw) > i64::from(sw)
                || i64::from(sy) + i64::from(rh) > i64::from(sh)
            {
                return Err(trap("invalid source rectangle"));
            }
            if flags & !15 != 0 || flags & 12 == 12 {
                return Err(trap("invalid blit flags"));
            }
            if tint as u32 > 0xffffff || !(0..=255).contains(&opacity) {
                return Err(trap("invalid tint or opacity"));
            }
            if !c.data().fb.true_color && (flags & 8 != 0 || tint != 0xffffff || opacity != 255) {
                return Err(trap("unsupported indexed destination operation"));
            }
            let count = (sw as usize)
                .checked_mul(sh as usize)
                .and_then(|n| n.checked_mul(if flags & 8 != 0 { 4 } else { 1 }))
                .ok_or_else(|| trap("source size overflow"))?;
            let bytes = read_mem_size(&mut c, ptr, count)?;
            c.data_mut().fb.blit_region(
                &bytes,
                sw,
                sh,
                sx,
                sy,
                rw,
                rh,
                x,
                y,
                dw,
                dh,
                flags,
                tint as u32,
                opacity as u8,
            );
            Ok(())
        },
    )?;

    // ── Palette (start()-only) ──────────────────────────────────────────
    linker.func_wrap(
        "calyx",
        "set_palette",
        |mut c: Caller<'_, State>, ptr: i32, count: i32| -> Result<(), Error> {
            if !c.data().in_start {
                return Err(trap("set_palette called outside start()"));
            }
            if !(0..=256).contains(&count) {
                return Err(trap(format!(
                    "set_palette count {count} out of range (0..=256)"
                )));
            }
            let bytes = read_mem(&mut c, ptr, count * 3)?;
            let st = c.data_mut();
            st.palette.set_from_rgb(&bytes, count as usize);
            st.fb.set_palette(st.palette.entries());
            Ok(())
        },
    )?;

    // ── Input handled host-side via State.btn (see run loop) ────────────

    // ── Audio (recorded as events) ──────────────────────────────────────
    linker.func_wrap(
        "calyx",
        "tone",
        |mut c: Caller<'_, State>,
         freq: i32,
         dur: i32,
         vol: i32,
         flags: i32|
         -> Result<(), Error> {
            // bits 0–1 waveform, 2–3 channel, 4–31 reserved-must-be-zero.
            if flags as u32 & 0xFFFF_FFF0 != 0 {
                return Err(trap(format!("tone reserved flag bits set: {flags:#x}")));
            }
            c.data_mut().audio.push(AudioEvent {
                freq,
                dur,
                vol,
                flags,
            });
            Ok(())
        },
    )?;

    // ── Debug / logging ─────────────────────────────────────────────────
    linker.func_wrap(
        "calyx",
        "trace",
        |mut c: Caller<'_, State>, ptr: i32, len: i32| -> Result<(), Error> {
            let bytes = read_mem(&mut c, ptr, len)?;
            let s = String::from_utf8_lossy(&bytes).into_owned();
            c.data_mut().traces.push(s);
            Ok(())
        },
    )?;

    // AssemblyScript's runtime calls env.abort on a failed assertion. The
    // founding prototype ignored it; v1 surfaces it as a fault.
    linker.func_wrap(
        "env",
        "abort",
        |mut c: Caller<'_, State>,
         _msg: i32,
         _file: i32,
         line: i32,
         col: i32|
         -> Result<(), Error> {
            c.data_mut().abort_msg = Some(format!("AS abort at {line}:{col}"));
            Err(trap("abort"))
        },
    )?;

    Ok(())
}

/// The additive ABI v1.2 `sys_cart_info` record: (name, author, version,
/// category), each `[u16-LE length][UTF-8 bytes]` (ABI §4b). The first three
/// fields retain their 63-byte cap; category is capped at 31 bytes, so the
/// record always fits a 256-byte guest buffer and old decoders can ignore the
/// trailing field.
pub fn encode_cart_info(cart: &SysCart) -> Vec<u8> {
    let mut out = Vec::new();
    for field in [&cart.name, &cart.author, &cart.version, &cart.category] {
        let bytes = field.as_bytes();
        out.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(bytes);
    }
    out
}

/// The pinned placeholder icon for entry `i`: all 4096 bytes equal to
/// `(i % 15) + 1` (ABI §6a).
pub fn placeholder_icon(i: i32) -> Vec<u8> {
    vec![((i % 15) + 1) as u8; 4096]
}

/// The `calyx.sys` module (ABI §4b) — registered ONLY for privileged
/// runs; a normal cart importing it fails at instantiation because the
/// module simply isn't linked (link-time privilege, no runtime checks).
fn register_sys_imports(linker: &mut Linker<State>) -> Result<(), Error> {
    linker.func_wrap("calyx.sys", "sys_cart_count", |c: Caller<'_, State>| {
        c.data().sys_carts.len() as i32
    })?;

    linker.func_wrap("calyx.sys", "sys_input_method", |c: Caller<'_, State>| {
        c.data().input_method as i32
    })?;

    linker.func_wrap(
        "calyx.sys",
        "sys_cart_info",
        |mut c: Caller<'_, State>, i: i32, ptr: i32| -> Result<i32, Error> {
            let Some(cart) = c.data().sys_carts.get(i as usize).cloned() else {
                return Ok(-1);
            };
            let record = encode_cart_info(&cart);
            write_mem(&mut c, ptr, &record)?;
            Ok(record.len() as i32)
        },
    )?;

    linker.func_wrap(
        "calyx.sys",
        "sys_cart_icon",
        |mut c: Caller<'_, State>, i: i32, ptr: i32| -> Result<i32, Error> {
            let Some(cart) = c.data().sys_carts.get(i as usize).cloned() else {
                return Ok(-1);
            };
            let icon = cart.icon.clone().unwrap_or_else(|| placeholder_icon(i));
            write_mem(&mut c, ptr, &icon)?;
            Ok(4096)
        },
    )?;

    linker.func_wrap(
        "calyx.sys",
        "sys_launch",
        |mut c: Caller<'_, State>, i: i32| -> Result<(), Error> {
            let n = c.data().sys_carts.len() as i32;
            if i < 0 || i >= n {
                return Err(trap(format!("sys_launch({i}) out of range (0..{n})")));
            }
            c.data_mut().sys.push(SysEvent::Launch(i));
            Ok(())
        },
    )?;

    linker.func_wrap("calyx.sys", "sys_exit", |mut c: Caller<'_, State>| {
        c.data_mut().sys.push(SysEvent::Exit);
    })?;

    Ok(())
}

fn make_fault(st: &mut State, f: i32, e: &Error) -> Fault {
    match st.abort_msg.take() {
        Some(msg) => Fault {
            f,
            kind: "abort".to_string(),
            msg,
        },
        None => Fault {
            f,
            kind: "trap".to_string(),
            msg: format!("{e}"),
        },
    }
}

/// A stepping cart host — the native mirror of the web runtime's
/// `createHost`: interactive presenters (window, watch) and
/// the headless verifier drive the *same* code path, so play cannot drift
/// from what verification measures. `Host` owns the wasmtime instance and
/// console state; the caller feeds it a `btn` mask per simulation tick and reads
/// back the framebuffer and the verified [`FrameRecord`].
pub struct Host {
    store: Store<State>,
    start_fn: TypedFunc<(), ()>,
    update_fn: TypedFunc<(), ()>,
    frame: i32,
}

impl Host {
    /// Load and instantiate a normal cart. A cart that imports
    /// `calyx.sys` fails here — system carts link an extra module this
    /// path does not provide (ABI §4b, link-time privilege).
    pub fn new(wasm: &[u8], w: i32, h: i32) -> Result<Host, LoadError> {
        Host::new_inner(wasm, w, h, None)
    }

    /// Load and instantiate a **system cart** — the runtime's deliberate
    /// choice to link `calyx.sys` (ABI §4b), with `carts` as the
    /// installed-cart list the privileged imports serve.
    pub fn new_system(wasm: &[u8], w: i32, h: i32, carts: Vec<SysCart>) -> Result<Host, LoadError> {
        for cart in &carts {
            cart.validate().map_err(LoadError)?;
        }
        Host::new_inner(wasm, w, h, Some(carts))
    }

    fn new_inner(
        wasm: &[u8],
        w: i32,
        h: i32,
        sys: Option<Vec<SysCart>>,
    ) -> Result<Host, LoadError> {
        let engine = Engine::default();
        let module =
            Module::from_binary(&engine, wasm).map_err(|e| LoadError(format!("load cart: {e}")))?;

        let state = State {
            fb: Framebuffer::new(w, h),
            palette: Palette::sweetie16(),
            font: font::m6x11(),
            frame: 0,
            btn: 0,
            in_start: false,
            color_selected: false,
            traces: Vec::new(),
            audio: Vec::new(),
            abort_msg: None,
            sys_carts: sys.clone().unwrap_or_default(),
            input_method: InputMethod::Keyboard,
            sys: Vec::new(),
        };
        let mut store = Store::new(&engine, state);
        let mut linker: Linker<State> = Linker::new(&engine);
        register_imports(&mut linker).map_err(|e| LoadError(format!("link imports: {e}")))?;
        if sys.is_some() {
            register_sys_imports(&mut linker)
                .map_err(|e| LoadError(format!("link calyx.sys: {e}")))?;
        }

        let instance = linker
            .instantiate(&mut store, &module)
            .map_err(|e| LoadError(format!("instantiate: {e}")))?;
        let start_fn = instance
            .get_typed_func::<(), ()>(&mut store, "start")
            .map_err(|e| LoadError(format!("export start: {e}")))?;
        let update_fn = instance
            .get_typed_func::<(), ()>(&mut store, "update")
            .map_err(|e| LoadError(format!("export update: {e}")))?;

        Ok(Host {
            store,
            start_fn,
            update_fn,
            frame: 0,
        })
    }

    /// Call the cart's `start()`. The palette is fixed once this returns
    /// (ABI §4 Palette). A trap here is the pre-frame fault (`f = -1`).
    pub fn start(&mut self) -> Result<(), Fault> {
        self.store.data_mut().in_start = true;
        let result = self.start_fn.call(&mut self.store, ());
        self.store.data_mut().in_start = false;
        if let Err(e) = result {
            return Err(make_fault(self.store.data_mut(), -1, &e));
        }
        self.store.data_mut().in_start = false;
        Ok(())
    }

    fn update(&mut self, btn: i32) -> Result<i32, Fault> {
        let f = self.frame;
        {
            let st = self.store.data_mut();
            st.frame = f;
            st.btn = btn;
            st.traces.clear();
            st.audio.clear();
            st.sys.clear();
        }
        if let Err(e) = self.update_fn.call(&mut self.store, ()) {
            return Err(make_fault(self.store.data_mut(), f, &e));
        }
        self.frame = f + 1;
        Ok(f)
    }

    /// Run one frame with `btn` held, returning its verified record.
    pub fn step(&mut self, btn: i32) -> Result<FrameRecord, Fault> {
        let f = self.update(btn)?;
        let st = self.store.data();
        Ok(FrameRecord {
            f,
            hash: st.fb.hash(),
            btn: input::names(btn),
            audio: st.audio.clone(),
            trace: st.traces.clone(),
            sys: st.sys.clone(),
        })
    }

    /// Run one interactive frame without hashing the framebuffer.
    ///
    /// This executes the same cart update and records the same event intent as
    /// [`Host::step`]. Verification-only work stays on `step`, while live
    /// presenters consume this smaller event record.
    pub fn step_live(&mut self, btn: i32) -> Result<LiveFrame, Fault> {
        let f = self.update(btn)?;
        let st = self.store.data();
        Ok(LiveFrame {
            f,
            audio: st.audio.clone(),
            trace: st.traces.clone(),
            sys: st.sys.clone(),
        })
    }

    /// Set the explicit presenter input context seen by privileged system
    /// carts. Ordinary carts cannot import this query.
    pub fn set_input_method(&mut self, method: InputMethod) {
        self.store.data_mut().input_method = method;
    }

    /// Frames stepped so far (the next `step` runs this frame index).
    pub fn frames_run(&self) -> i32 {
        self.frame
    }
    pub fn fb(&self) -> &Framebuffer {
        &self.store.data().fb
    }
    pub fn palette_rgb(&self) -> &[(u8, u8, u8)] {
        self.store.data().palette.entries()
    }
    pub fn palette_id(&self) -> String {
        self.store.data().palette.id()
    }
}

/// Load a cart `.wasm` and run it headless for `cfg.frames` frames against
/// `cfg.feed`, returning the verified [`RunReport`]. A cart that imports
/// `calyx.sys` fails to load here — system carts link an extra module the
/// core runtime does not provide (ABI §4b, link-time privilege).
pub fn run(wasm: &[u8], cfg: &RunConfig, cart_name: &str) -> Result<RunReport, LoadError> {
    run_with(wasm, cfg, cart_name, &mut NoSink)
}

/// Like [`run`], but also feeds each frame to a [`FrameSink`] presenter as
/// it is produced (the verified state is identical either way).
pub fn run_with(
    wasm: &[u8],
    cfg: &RunConfig,
    cart_name: &str,
    sink: &mut dyn FrameSink,
) -> Result<RunReport, LoadError> {
    let mut host = if cfg.system {
        Host::new_system(wasm, cfg.w, cfg.h, cfg.feed.carts.clone())?
    } else {
        Host::new(wasm, cfg.w, cfg.h)?
    };

    let mut report = RunReport {
        cart: cart_name.to_string(),
        w: cfg.w,
        h: cfg.h,
        palette_id: "SWEETIE_16".to_string(),
        true_color: false,
        frames_run: 0,
        run_hash: 0,
        final_hash: 0,
        frames: Vec::new(),
        fault: None,
        input_label: cfg.input_label.clone(),
        system: cfg.system,
    };

    host.set_input_method(cfg.feed.input_method_at(0));

    // start() — a trap here faults the run before any frame.
    if let Err(fault) = host.start() {
        report.fault = Some(fault);
        report.palette_id = host.palette_id();
        report.true_color = host.fb().true_color;
        sink.end(&report);
        return Ok(report);
    }

    // The palette is fixed after start() (ABI §4 Palette), so the presenter
    // gets it once up front.
    sink.begin(cfg.w, cfg.h, host.palette_rgb());

    let mut run_hash = Fnv::new();
    let mut last_hash = 0u64;
    for f in 0..cfg.frames {
        host.set_input_method(cfg.feed.input_method_at(f));
        match host.step(cfg.feed.at(f)) {
            Err(fault) => {
                report.fault = Some(fault);
                break;
            }
            Ok(rec) => {
                run_hash.write(&rec.hash.to_le_bytes());
                last_hash = rec.hash;
                sink.frame(host.fb(), &rec);
                report.frames.push(rec);
                report.frames_run = f + 1;
            }
        }
    }

    report.run_hash = run_hash.finish();
    report.final_hash = last_hash;
    report.palette_id = host.palette_id();
    report.true_color = host.fb().true_color;
    sink.end(&report);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_cart() -> Vec<u8> {
        wat::parse_str(
            r#"(module
                (import "calyx" "frame" (func $frame (result i32)))
                (import "calyx" "rect" (func $rect (param i32 i32 i32 i32 i32)))
                (import "calyx" "tone" (func $tone (param i32 i32 i32 i32)))
                (memory (export "memory") 1)
                (func (export "start"))
                (func (export "update")
                    call $frame
                    i32.const 0
                    i32.const 1
                    i32.const 1
                    i32.const 7
                    call $rect
                    i32.const 440
                    i32.const 2
                    i32.const 30
                    i32.const 0
                    call $tone))"#,
        )
        .expect("valid event cart")
    }

    fn drawing_cart(start: &str, update: &str, extra: &str) -> Vec<u8> {
        wat::parse_str(format!(r#"(module
            (import "calyx" "set_color_mode" (func $mode (param i32)))
            (import "calyx" "rgba_cls" (func $cls (param i32)))
            (import "calyx" "blit_region" (func $blit (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32)))
            (memory (export "memory") 1)
            (func (export "start") {start}) (func (export "update") {update}) {extra})"#)).unwrap()
    }
    #[test]
    fn color_mode_lifecycle_and_indexed_restrictions_trap() {
        for (start, update) in [
            ("(call $mode (i32.const 2))", ""),
            ("(call $mode (i32.const 0)) (call $mode (i32.const 1))", ""),
            ("", "(call $mode (i32.const 1))"),
            ("", "(call $cls (i32.const 0))"),
        ] {
            let report = run(&drawing_cart(start, update, ""), &RunConfig::new(1), "test").unwrap();
            assert_eq!(report.fault.unwrap().kind, "trap");
        }
        let wasm = drawing_cart(
            "",
            "",
            "(func $init (call $mode (i32.const 1))) (start $init)",
        );
        assert!(Host::new(&wasm, 2, 2).is_err());
    }
    #[test]
    fn blit_validates_full_sources_flags_and_no_op_draws() {
        let valid = [0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 8, 0xffffff, 255];
        for (arg, bad) in [
            (0, -1),
            (0, 65535),
            (1, -1),
            (1, i32::MAX),
            (3, 1),
            (11, 16),
            (11, 12),
            (12, -1),
            (13, -1),
            (13, 256),
        ] {
            let mut args = valid;
            args[arg] = bad;
            let call = format!(
                "(call $blit {})",
                args.iter()
                    .map(|n| format!("(i32.const {n})"))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            let report = run(
                &drawing_cart("(call $mode (i32.const 1))", &call, ""),
                &RunConfig::new(1),
                "test",
            )
            .unwrap();
            assert!(report.fault.is_some(), "arg {arg}={bad}");
        }
        let call = format!(
            "(call $blit {})",
            valid
                .iter()
                .map(|n| format!("(i32.const {n})"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        assert!(
            run(&drawing_cart("", &call, ""), &RunConfig::new(1), "test")
                .unwrap()
                .fault
                .is_some()
        );
    }

    #[test]
    fn rgba_rounding_is_literal_and_opaque() {
        let wasm = wat::parse_str(r#"(module
          (import "calyx" "set_color_mode" (func $mode (param i32)))
          (import "calyx" "rgba_cls" (func $cls (param i32)))
          (import "calyx" "rgba_rect" (func $rect (param i32 i32 i32 i32 i32)))
          (func (export "start") (call $mode (i32.const 1)))
          (func (export "update")
            (call $cls (i32.const 0x10203000))
            (call $rect (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 1) (i32.const 0xe0800180))))"#).unwrap();
        let mut host = Host::new(&wasm, 2, 1).expect("drawing imports linked");
        host.start().unwrap();
        host.step(0).unwrap();
        assert_eq!(host.fb().px, [120, 80, 24, 255, 16, 32, 48, 255]);
    }

    #[test]
    fn live_step_matches_verified_effects_without_a_hash_record() {
        let wasm = event_cart();
        let mut verified = Host::new(&wasm, 4, 2).expect("verified host");
        let mut live = Host::new(&wasm, 4, 2).expect("live host");
        verified.start().expect("verified start");
        live.start().expect("live start");

        let record = verified.step(1 << 4).expect("verified step");
        let frame = live.step_live(1 << 4).expect("live step");

        assert_eq!(frame.f, record.f);
        assert_eq!(frame.audio, record.audio);
        assert_eq!(frame.trace, record.trace);
        assert_eq!(frame.sys, record.sys);
        assert_eq!(live.frames_run(), verified.frames_run());
        assert_eq!(live.fb().px, verified.fb().px);
        assert_eq!(live.fb().hash(), record.hash);
    }

    #[test]
    fn cart_info_record_is_the_pinned_layout() {
        // (name, author, version, category) × [u16-LE len][UTF-8] — ABI §4b.
        let rec = encode_cart_info(&SysCart {
            name: "checker".into(),
            author: "Cheesy Crab".into(),
            version: "0.1.0".into(),
            category: "Demos".into(),
            icon: None,
        });
        let mut want = Vec::new();
        for s in ["checker", "Cheesy Crab", "0.1.0", "Demos"] {
            want.extend_from_slice(&(s.len() as u16).to_le_bytes());
            want.extend_from_slice(s.as_bytes());
        }
        assert_eq!(rec, want);
        // max record with the 63-byte cap fits a 256-byte guest buffer
        let cap = encode_cart_info(&SysCart {
            name: "n".repeat(63),
            author: "a".repeat(63),
            version: "v".repeat(63),
            category: "c".repeat(31),
            icon: None,
        });
        assert_eq!(cap.len(), 3 * (2 + 63) + 2 + 31);
        assert!(cap.len() <= 256);
    }

    #[test]
    fn placeholder_icon_is_pinned() {
        // all 4096 bytes equal to (i % 15) + 1 — ABI §6a.
        assert_eq!(placeholder_icon(0), vec![1u8; 4096]);
        assert_eq!(placeholder_icon(14), vec![15u8; 4096]);
        assert_eq!(placeholder_icon(15), vec![1u8; 4096]);
        assert_eq!(placeholder_icon(2)[..4], [3, 3, 3, 3]);
    }
}
