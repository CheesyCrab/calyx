# Calyx CLI (`calyx`)

The native Calyx executable provides headless dump, terminal/winit/SDL2
presenters, hot reload, boot-to-launcher, audible tone presentation, and the
conformance harness. When an SDL build finds an adjacent `catalog/`, zero
arguments boot that packaged product directly. Explicit CLI commands and
`tools/catalog.py` remain the supported source-development surfaces.

## Build prerequisites

Run source commands from the Calyx repository root. Install Rust 1.95 or newer and Cargo.
Catalog and conformance commands also require Python 3.11+, Node.js 20+, and npm 10+.
The default build enables the native window and audio presenters:

```sh
cargo build -p calyx-cli
cargo run -p calyx-cli -- --help
```

The command synopsis below assumes `calyx` is on `PATH`. Otherwise use
`cargo run -p calyx-cli --` before the command arguments. A headless or
terminal-only build uses `--no-default-features`. For the SDL presenter,
install CMake and a C/C++ toolchain, then use:

```sh
cargo run -p calyx-cli --no-default-features --features sdl-bundled -- \
  run --cart path/to/cart.wasm --present sdl
```

`--features sdl` links a separately installed SDL2 library; `sdl-bundled`
builds that library. Platform window/audio libraries are required when their
features are enabled.

All presenters accept indexed and RGBA8888 framebuffers. Color selection is a
cart `start()` operation; `--width` and `--height` select resolution. Indexed
dumps retain their profile format; true-color dumps add
`profile.color = "rgba8888"` and hash canonical RGBA bytes.

## Commands

```
calyx --version
calyx run --cart <wasm> [--frames N] [--in <feed.json>] [--out <dir>]
          [--present headless|term|window|sdl] [--every N] [--fps N]
          [--width W] [--height H] [--audio on|off] [--fullscreen on|off]
          [--controller-db <gamecontrollerdb.txt>]
          [--perf-log-dir <directory>]
calyx watch --cart <wasm> [--src <file-or-dir> --build "<cmd>"]
          [--present term|window|sdl|headless] [--in <feed.json>] [--fps N]
          [--width W] [--height H] [--audio on|off] [--fullscreen on|off]
          [--controller-db <gamecontrollerdb.txt>]
          [--perf-log-dir <directory>]
calyx console --carts <dir> [--present window|sdl|headless|term] [--frames N]
          [--in <feed.json>] [--out <dir>] [--every N] [--fps N]
          [--width W] [--height H] [--audio on|off] [--fullscreen on|off]
          [--controller-db <gamecontrollerdb.txt>]
          [--perf-log-dir <directory>]
calyx bench-sdl --cart <wasm> [--frames N] [--warmup N] [--in <feed.json>]
          [--width W] [--height H] [--out <report.json>]
calyx verify [--suite <dir>] [--jobs N]          # grade conformance (the gate)
calyx bless  [--suite <dir>] [--jobs N] [cart …] # rewrite expected + golden
calyx soak   [--cycles N] [--out <report.json>] # product release tripwire
```

Cart simulation is always the ABI-pinned 60 Hz fixed step. For terminal,
window, and SDL presenters, `--fps` accepts `30` or `60` and controls only how
often the latest framebuffer is shown; at 30 fps the runtime executes two
ordered simulation ticks per presentation. Headless modes have no presentation
cadence and reject `--fps`. `--frames` always counts simulation ticks.

- **`run`** drives [`core`](../core) and presents the result: the two-tier
  headless dump (`status.json` + `frames.jsonl` + PNG sidecars, ABI §6a)
  when `--out` is given, the terminal presenter (`--present term`), native
  winit presenter (`--present window`), or portable SDL2 presenter (`--present
  sdl`). The per-frame serializer is also used by `bless`, so recorded frame
  data uses the same format as the golden files.
- **`watch`** is the editor-free loop: poll the cart and optional source
  tree, run `--build` when source changes, hot-swap the `.wasm`, and
  restart from frame 0 so reloads replay like cold starts.
- **`console`** boots a console directory through the launcher system cart,
  acts on verified `sys_launch` / `sys_exit` intent, and swaps between
  ordinary carts and system carts. Backspace returns an active cart to the
  launcher; Escape quits the presenter. While a cart is running, either
  destructive action opens a cancel-first confirmation without advancing the
  cart; launcher and boot actions remain immediate.
- **`verify`** grades every cart in the suite against `core` and localizes
  the first divergent frame on failure — the native, no-display gate that
  CI runs. `verify` and `bless` forward
  `--jobs N` to the conformance compiler; the default is at most four workers,
  `--jobs 1` is serial, and `CALYX_BUILD_JOBS=N` works through wrappers.
- **`bless`** mints `[expected]` hashes + `frames.golden.jsonl` from a
  `core` run (the same numbers `verify` checks).
- **`soak`** repeatedly runs and drops representative public carts in one
  release process, verifies their hashes, and records throughput, peak RSS,
  and per-cycle high-water growth. See [Soak](#soak).
- **`bench-sdl`** runs a cart uncapped through the same indexed/RGBA-to-ARGB
  expansion and SDL ARGB8888 streaming-texture upload/copy/present operations
  as the live presenter. It forces SDL's dummy video and software renderer,
  warms up for 120 frames, measures 600 by default, and prints a JSON report
  with mean, p95, and maximum SIM/RGB/SDL costs. This is a stable host-side A/B
  facsimile; it does not predict a handheld GPU driver or thermal behavior.
- **Window audio** defaults on and turns verified `tone` events into the
  four ABI waveforms through the default output device. `--audio off`
  disables it. Missing or failed devices degrade to silence; headless and
  terminal presentation stay silent. Synthesis is unverified presenter
  output—the frame-stamped events remain the golden.
- **SDL2** is the portable native presenter (`--present sdl`): fullscreen
  nearest-neighbor integer scaling with letterbox, SDL keyboard/controllers,
  and an SDL speaker queue fed by the same `ToneSynth`. The D-pad and left
  stick both supply the four directions; A/B/Start complete the Classic
  controls. Extended-input console carts also receive X/Y/L/R. Controller
  Back/View returns to the launcher and Guide/Home quits.
  `--controller-db` loads extra mappings for firmware whose controller is not
  in SDL's built-in database. `--fullscreen off` provides a resizable
  desktop-development window. The `sdl` Cargo feature is deliberately outside
  the default `window + audio` build; the catalog `play-sdl` command enables
  the SDL presenter automatically.
  With the performance panel visible, L+R then Y (Q+W then S on a keyboard)
  starts or stops a CSV capture under `--perf-log-dir`. Packaged adapters may
  set `CALYX_PERF_LOG_DIR` instead. Each flushed row describes one completed
  approximately one-second measurement window; turning the panel off also
  stops the capture.

```
src/
  main.rs      arg dispatch (run / watch / console / verify / bless / soak)
  audio.rs     pure four-channel tone synth + optional cpal speaker sink
  console.rs   boot-to-launcher runner over system-cart intent
  dump.rs      status.json + frames.jsonl + PNG sidecars (the one serializer)
  present.rs   terminal half-block presenter (a dumb, unverified sink)
  sdl.rs       portable SDL2 video/controller/audio presenter (feature `sdl`)
  soak.rs      release-candidate workload + resource-envelope report
  suite.rs     the verify/bless harness over the conformance suite
  timing.rs    fixed-60 simulation pacer + 30/60 presentation cadence
  watch.rs     hot-reload loop over the shared simulation pacer
  window.rs    native window presenter (feature `window`)
```

The presenters are modules here, not separate executables: one CLI and native
runtime own several unverified output/input adapters. The language-agnostic
`conformance/check.py` stays the adapter
for runtimes without a native grader; `calyx verify` is the native path and
`node web/conform.mjs` is the web path.

## Soak

`calyx soak` is a small release-mode regression tripwire, not a benchmark
suite. It runs these public carts from their canonical public conformance feeds
and verifies every run hash:

- Horizon Burn
- Wormtide
- Seaway Dig
- Micro AI War

The default five cycles execute 95,750 frames and instantiate/drop 20 carts in
one process. On Unix, peak RSS comes from `getrusage`; per-cycle samples are
monotonic high-water marks. Growth is the final high-water mark less cycle
one's, so startup allocation does not count as post-first-cycle growth.
Unsupported hosts fail explicitly rather than report a misleading value.

Build the public catalog and write the report with:

```sh
python3 tools/catalog.py build --profile dev
cargo run --release -p calyx-cli -- soak \
  --cycles 5 --out build/soak-report.json
```

The JSON report uses schema `1`. It records the representative carts, cycles,
total frames, elapsed time, throughput and 60 Hz headroom, RSS start/peak and
growth, the applied limits, per-check results, per-cycle samples, per-run
hashes, and the final pass result.

The enforced defaults are 300 frames/s minimum, 512 MiB maximum peak RSS, and
64 MiB maximum growth after the first cycle. A failed threshold requires
inspection of the report trend and cart hashes; do not retune a limit for a
particular CPU.
