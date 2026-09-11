# Calyx core

The presenter-independent native runtime, implementing
[ABI v1.6](../../docs/ABI.md).

The console with *zero opinion about where pixels go*: framebuffer,
palette, input, the embedded `m6x11` font, and the wasmtime cart host
wired to the ABI §4 imports. It loads a cart `.wasm`, runs it headless
against a scripted input feed, and returns verified state — the
`run_hash` gate plus the per-frame record (ABI §6a).

```
src/
  framebuffer.rs   host-owned indexed/RGBA buffer; clips silently (ABI §2)
  palette.rs       SWEETIE_16 default + per-cart set_palette; palette id
  font.rs          the embedded m6x11 font (assets/fonts/m6x11-v1.json)
  input.rs         Classic + extended digital input and scripted feeds (ABI §6a)
  hash.rs          FNV-1a 64-bit — the pinned hash (ABI §7)
  runtime.rs       wasmtime host: ABI §4 imports + the headless run loop
tests/
  conformance.rs   determinism smoke on real carts (full grading is `calyx verify`)
```

Presenters (window, terminal, and headless dump files) plus the `verify` and
`bless` commands belong to the CLI crate; core produces the verified state they
consume.

Run `cargo test -p calyx-core` from the Calyx repository root with Rust and
Cargo installed. It runs unit tests plus a determinism smoke test on real
carts. The smoke uses `python3 conformance/check.py build`, which requires
Python 3.11+, Node.js 20+, and npm 10+ and installs the pinned compiler under
`conformance/node_modules/` when necessary. If that build fails, the smoke
skips; a passing unit-test run therefore does not prove full conformance.
Run `cargo run -p calyx-cli -- verify --suite conformance` for full grading.

Indexed color is the default. A cart may select RGBA8888 once during exported
`start()`, independently of resolution. Both modes support clipping and
nearest-neighbor sprite regions. True color adds straight-alpha source-over,
tint, and opacity, while legacy indexed drawing resolves the current palette
when each pixel is written. Frame hashes cover index bytes in indexed mode or
canonical row-major RGBA bytes with alpha 255 in true-color mode.
