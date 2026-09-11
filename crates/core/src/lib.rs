//! # calyx-core
//!
//! The presenter-independent Calyx console: framebuffer,
//! palette, input, the embedded `m6x11` font, and the wasmtime cart host
//! wired to the locked **ABI v1.6** (`calyx/docs/ABI.md`). It loads a
//! cart `.wasm`, runs it headless against a scripted input feed, and
//! returns verified state — the `run_hash` gate and the per-frame record.
//!
//! It has *zero opinion about where pixels go*: presenters (window,
//! terminal, headless dump files) and the `verify`/`bless` harness live in
//! the CLI crate (T4). The conformance suite is graded against this crate
//! via the integration test in `tests/conformance.rs`.

pub mod font;
pub mod framebuffer;
pub mod hash;
pub mod input;
pub mod palette;
pub mod runtime;

pub use framebuffer::Framebuffer;
pub use input::{Feed, InputMethod, SysCart};
pub use palette::Palette;
pub use runtime::{
    run, run_with, AudioEvent, Fault, FrameRecord, FrameSink, Host, LiveFrame, LoadError, NoSink,
    RunConfig, RunReport, SysEvent,
};
