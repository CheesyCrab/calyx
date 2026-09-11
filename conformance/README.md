# Calyx conformance suite — the runtime-agnostic oracle

This directory is the grading rubric every Calyx runtime must pass: carts,
input feeds, and expected hashes graded identically for the native runtime and
web runtime. The contract being tested is
[`ABI.md`](../docs/ABI.md); nothing in this suite adds to or interprets it.
Version naming follows [`VERSIONING.md`](../docs/VERSIONING.md).

The suite is **self-describing**: everything a grader needs is in each
cart's `cart.toml` and this file. `check.py` is a convenience runner,
not a source of hidden knowledge — a runtime that reimplements the
steps below from the manifests alone must reach the same verdicts.

## What a suite entry is

```
carts/<name>/
  cart.toml        # the manifest — binds (cart, frames, feed) to hashes
  cart.ts          # AssemblyScript source (or a thin product-cart wrapper)
  <name>.in.json   # scripted input feed (ABI §6a), if the cart needs one
  events.golden.jsonl  # expected audio-event stream, if the cart plays audio
  frames.golden.jsonl  # blessed per-frame record — not graded; used only
                       # to localize the first divergent frame on FAIL
```

### `cart.toml`

```toml
[cart]
name  = "checker"
entry = "cart.ts"
abi   = "v1"          # major ABI line; see "ABI targeting"
# system = true          # a §4b SYSTEM cart: the runtime links calyx.sys
#                        # and the feed's `carts` key scripts the list

[run]
frames = 30
feed   = "checker.in.json"   # omit if the cart takes no input
# width = 1280             # optional; default 320
# height = 720             # optional; default 240

[witness]                     # anti-vacuous-golden checks
min_distinct_frame_hashes = 4

[expected]                    # omit entirely while pending bless
run_hash   = "229f7fafed80e884"
final_hash = "f133490327d9ef36"
palette    = "SWEETIE_16"     # or "custom:<digest>" (ABI §6a)
# color = "rgba8888"        # required for true color; omit for indexed
blessed_by = "core"           # provenance: which runtime blessed these
```

A manifest **without** an `[expected]` section is **pending bless**: the cart is
part of the suite and must build, but no runtime is graded against it yet.
Accepted native goldens record `blessed_by = "core"`.

### `[fault]` — carts that are *expected* to fault

A cart whose manifest carries a `[fault]` section instead of `[expected]`
is graded on its **fault record** (ABI §6a), not a `run_hash` — it pins
the error paths cross-runtime:

```toml
[fault]
frame = 0        # the update() frame the trap occurs on
kind  = "trap"   # "trap" | "abort" | "load"  (msg is never compared)
```

A runtime passes such a cart iff the run faults with that `kind` on that
`frame`. Kind `"load"` (v1.1) is the §4b privilege gate: the cart must
be **refused at instantiation** (`frame` is ignored) — it is a normal
cart whose `.wasm` imports `calyx.sys`. These carts are skipped by
`bless` (no hash to mint).

## How a runtime passes

For every cart whose manifest has an `[expected]` section and whose
`abi` dialect the runtime implements:

1. Build `entry` with `asc <entry> --outFile <cart>.wasm --optimize`
   using the exact AssemblyScript version pinned in `package.json` and
   `package-lock.json` (currently 0.28.20). The compiler is a reproducible
   build input, not part of the cart/runtime ABI.
2. Run the runtime headless for `run.frames` frames with `run.feed`
   (ABI §6a): it must write `status.json` and `frames.jsonl` into an
   output directory.
3. The run **passes** iff, in `status.json`:
   - `run_hash` equals `expected.run_hash` (**the gate** — whole-run),
   - `final_hash` equals `expected.final_hash`,
   - `profile.palette` equals `expected.palette`,
   - `profile.color` equals `expected.color` (both absent for indexed color),
   - there is no `fault` record;
   and, from `frames.jsonl`:
   - the count of distinct per-frame `hash` values is ≥ every
     `[witness]` minimum (a green golden must not be vacuous),
   - if `events.golden.jsonl` exists: for each line `{"f": N,
     "audio": [...], "sys": [...]}` in it (either key may be omitted
     for an empty array), frame `N`'s `audio` and `sys` arrays match
     exactly, and every frame *not* listed has both empty. `sys` is
     the v1.1 privileged event stream (launch/exit intent, ABI §6a) —
     only system carts ever have one.

A runtime **passes the suite** when every gradable cart passes. Hashes
are FNV-1a 64-bit exactly as pinned in ABI §6a.

### Runner invocation contract

The convenience runner invokes a runtime as:

```
<runtime-cmd> --cart <cart.wasm> --frames <N> --out <dir> [--in <feed>]
              --width <W> --height <H> [--system]
```

which is `calyx run`'s flag set (`--system`, v1.1, asks the runtime to
link `calyx.sys` for a system manifest). A runtime with a different CLI
just needs a one-line adapter; the grading rules above are the contract,
not the flags.

## ABI targeting

`abi = "v1"` means the major Calyx ABI v1 line, not the product version
and not a package version. Use an exact minor only when a fixture needs
to distinguish minor-version behavior. See
[`docs/VERSIONING.md`](../docs/VERSIONING.md).

Most conformance carts author through Sunny (`../sdk/assembly/`), imported
by relative path. Sunny compiles into each cart, so the suite pins its geometry,
metrics, sequencer, and PRNG together with the host surface. Drawing and fault
fixtures also use direct ABI imports to isolate host behavior. The `music-box`
cart exercises the SDK music interface.

## Representative carts

| Cart | Dialect | Status | What it pins |
|---|---|---|---|
| `checker` | v1 | blessed (core) | the mechanism: frame-driven drawing, `btn()` hold, `rect`/`cls`, text, `trace` |
| `particles` | v1 | blessed (core) | seeded-PRNG physics — integer determinism under chaos; input-driven physics (hold A) |
| `text-grid` | v1 | blessed (core) | the whole `m6x11` glyph range, advances, `scale` 1/2/3, off-edge clipping, non-ASCII placeholder bytes |
| `clip-box` | v1 | blessed (core) | silent clipping of `pixel`/`rect`/`hline`/`vline` at and far beyond all four edges, zero/negative sizes; per-frame input edge cases (1-frame taps, all-buttons, rapid toggle) |
| `av-events` | v1 | blessed (core) | `set_palette` at start (custom palette as verified state), `blit` 1:1 with flip-x/flip-y/color-key, `tone` events as a verified stream |
| `music-box` | v1 | blessed (core) | the Sunny surface: sequencer tone stream (drums/voices/sfx/stop_music) as `events.golden.jsonl`, guest-side geometry, text metrics, screen utils |
| `launcher` | v1 | blessed (core), **system** | the §4b surface: category-appended `sys_cart_info`, icon (real + placeholder), scripted keyboard/controller/touch prompt changes, selection input, and `sys_launch` as a verified event |
| `settings` | v1 | blessed (core), **system** | transient settings, row navigation/edits, scripted adaptive input prompts, and `sys_exit` as a verified event |
| `boot` | v1 | blessed (core), **system** | deterministic product boot ceremony: framebuffer progression, latch/core audio events, traces, and exact `sys_exit` frame |
| `micro-ai-war` | v1 | blessed (core), **product** | muster, tactile doctrine editing, role-relative autonomous battle, debrief, tweak, and deterministic rematch |
| `split-flap-fortunes` | v1 | blessed (core), **product** | fortune-board animation, next/previous navigation, and clack audio events |
| `horizon-burn` | v1 | blessed (core), **product prototype** | 1.5x dust curve, boss-fed late tiers, first-visible-frame hits, six phases, staged Warden explosion outro, and result/restart |
| `fault-palette` | v1 | `[fault]` | a **deliberate fault**: `set_palette` during `update()` → trap @f0, surfaced as verified state (§6a) |
| `fault-abort` | v1 | `[fault]` | a **deliberate fault**: AssemblyScript `assert(false)` → `env.abort` @f3, surfaced as kind `abort` |
| `sys-load-error` | v1 | `[fault]` kind `load` | a **deliberate privilege violation**: a normal cart importing `calyx.sys` must be refused at instantiation (§4b link-time privilege) |

All active hashes are `blessed_by = "core"`. The web runtime reproduces the
same oracle independently.

## Running it

Install Rust and Cargo, Python 3, Node.js, and npm. Run these commands from the
Calyx repository root. The conformance builder installs its pinned npm
compiler when necessary. Each runtime has its own grader; run both for the
cross-runtime parity gate:

```
cargo run -p calyx-cli -- verify --suite conformance  # native core (Rust)
node web/conform.mjs --suite conformance  # web runtime (JavaScript)
cargo run -p calyx-cli -- bless --suite conformance <cart>  # rewrite selected goldens
```

Core also has `cargo test -p calyx-core`: unit tests plus a real-cart smoke
that skips if the external cart build fails. This does not replace full
grading. Web unit tests run with `npm --prefix web test`. The remaining
examples assume the built `calyx` executable is on `PATH`.

The `check.py` convenience runner builds the carts and can grade any
runtime that speaks the `--cart/--frames/--out/--in` CLI (it grades
`calyx run`):

```sh
python3 conformance/check.py build                # asc-compile every cart
python3 conformance/check.py verify --runtime-cmd "<cmd>"  # grade any runtime
python3 conformance/check.py bless --runtime-cmd "<cmd>" <cart>  # write [expected]
```

The omitted `--suite` defaults to this directory. A separate suite can reuse
the same runner and pinned compiler without changing the public suite:

```sh
python3 conformance/check.py --suite path/to/suite build
calyx verify --suite path/to/suite
node web/conform.mjs --suite path/to/suite
```

Manifest discovery, Wasm build products, input feeds, outputs, and goldens all
remain relative to the selected suite. Compiler lookup remains anchored at
`conformance/node_modules/.bin/asc`.

Conformance cart compilation uses at most `min(CPU count, 4)` workers and
replays each command's captured output in manifest order. `--jobs N` is
accepted by `check.py build/verify/bless` and by native `calyx verify/bless`;
`--jobs 1` is the serial escape hatch. `CALYX_BUILD_JOBS=N` supplies the same
default across the native wrapper, direct checker, and `web/conform.mjs`.
All compiles finish before grading or blessing begins, and any failed compile
stops those later steps after every already-submitted failure is reported.

`verify` exits nonzero on any FAIL or if nothing was gradable. `core` is the
native runtime that passes the whole suite.

## Drawing v1.6 fixtures

`drawing-indexed` pins scaled and cropped indexed sprites with clipping and
flips. `drawing-rgba` and `drawing-rgba-hd` execute the same direct-ABI drawing
program at 320×240 and 1280×720. They cover partial alpha, tint plus opacity,
custom-palette indexed sprites drawn into true color, source rectangles,
clipping, text, and extreme offscreen destination coordinates. True-color
fixtures require `expected.color = "rgba8888"` as well as palette and hashes;
indexed fixtures omit color identity and retain their original byte format.

The `fault-color-*`, `fault-rgba-indexed`, and `fault-region-*` fixtures reject
illegal color lifecycle calls, unsupported indexed compositing, invalid source
rectangles, invalid flags, and invalid memory even when no pixel would draw.
Literal channel-rounding tests in each runtime complement these shared
framebuffer fixtures; cross-runtime agreement alone is not the arithmetic
specification.
