# Running Calyx

Calyx can run from a source checkout or from a package assembled for the
current platform. Run source commands from the Calyx root (the directory
containing `Cargo.toml` and `play-window.sh`).

## Prerequisites for source runs

- Rust 1.95 or newer and Cargo
- Node.js 20 or newer and npm 10 or newer
- Python 3.11 or newer

The catalog tools install cart npm dependencies when necessary. Native builds
also need the platform libraries described in the
[CLI prerequisites](../crates/cli/README.md#build-prerequisites). For SDL, install
CMake and a C/C++ toolchain; the wrapper builds SDL2 for you.

## Native window

On macOS or Linux:

```sh
./play-window.sh
```

On Windows:

```bat
play-window.bat
```

The command builds changed carts, shows the boot cart, and opens the developer
catalog. Select the curated catalog with `--profile release`.

## Browser player

On macOS or Linux:

```sh
./serve-pwa.sh --profile release
```

On Windows:

```bat
serve-pwa.bat --profile release
```

Open the URL that the command prints. For a device on the same local network,
use the printed LAN address rather than `127.0.0.1`. The browser player supports
keyboard, standard Gamepad API controllers, and a responsive touch deck. Add
`?touchdebug` to show the touch deck with a desktop pointer.

The player works over ordinary HTTP, but a browser can require a secure origin
before it permits progressive web app installation or some sharing features.

At the launcher, choose **Upload** to learn what local carts are and select one
`.wasm` file.
The player reads the file directly from the device and neither uploads nor
persists it. Local carts run in a disposable worker with ordinary ABI imports,
bounded memory and events, and hang watchdogs. Home destroys that worker and
returns to the built-in launcher. See [Cart Authoring](CART_AUTHORING.md) for
the downloadable starter and exact local-cart limits.

## SDL player

The SDL presenter is the controller-first native player:

```sh
./play-sdl.sh
```

On Windows, use `play-sdl.bat`. SDL starts full screen. Use a window or load an
additional controller mapping database with:

```sh
./play-sdl.sh --fullscreen off
./play-sdl.sh --controller-db path/to/gamecontrollerdb.txt
```

## Controls

| Action | Keyboard | Controller | Touch |
|---|---|---|---|
| Move/select | Arrows or WASD | D-pad (SDL also accepts left stick) | D-pad |
| A | Z | South face button | A |
| B | X | East face button | B |
| Context/help | Enter | Start | Menu |
| Return to launcher | Backspace | Back/View | Home |
| Quit | Escape | Guide/Home | — |
| Toggle performance panel | Q+W, then A | L+R, then X | Help → Advanced → Performance overlay |
| Toggle SDL performance log (panel visible) | Q+W, then S | L+R, then Y | — |

Controller mappings apply to SDL and the browser. The basic native window and
terminal use the keyboard. The keyboard/controller performance chords are
SDL-only; the browser toggle lives in Help.

Enter, controller Start, and touch Menu all send the ABI `START` input. Return
to launcher and Quit are presenter actions, not cart input bits.

An extended-input cart uses arrows, Z/X for A/B, A/S for X/Y, Q/W for L/R,
and Enter. Standard controllers use the west/north face buttons for X/Y and
the left/right shoulders for L/R. Extended carts do not use analog axes or
triggers.

HD carts with Classic input retain the D-pad, A/B, Menu, and Home touch controls.

On touch devices, extended HD carts expose all eleven inputs in both
orientations. Portrait keeps the 16:9 framebuffer above a compact full control
deck. Landscape reserves the framebuffer center: L, Home, and the D-pad align
to the left safe edge, while R, Menu, and a fluid X/Y/A/B diamond use the right
gutter. No cart or shell touch target overlays the framebuffer. The deck fades
at rest but remains hit-testable and wakes on input.

Catalog HD launches require the window, SDL, web, or headless presenter. The
terminal presenter remains Classic-only and reports an error instead of
running an HD cart at the wrong dimensions.

The SDL presenter treats its left stick as digital directions with separate
press and release thresholds. The browser Gamepad path uses digital controls.
The web player's Advanced help panel can toggle a presenter-only performance
overlay. It reports actual/target FPS, average simulation time per 60 Hz tick,
combined framebuffer-conversion plus canvas draw time per presented frame, and the
share of the target frame budget consumed by those measured stages. It stays
enabled across launcher and cart transitions until toggled off.

The SDL-only performance panel remains visible across Classic, system boots,
and HD carts until the same chord toggles it off. It reports actual presented
FPS plus average simulation, framebuffer-to-RGB conversion, and SDL
upload/copy/present milliseconds over the last second. `SDL` is driver-path
time, not a claim of direct GPU timing.

Pass `--perf-log-dir <directory>` to enable controller-started CSV capture.
With the performance panel visible, hold L+R and press Y to start or stop a
capture. The panel shows `REC LOGGING` while rows are being written. Each row
is flushed after one approximately one-second measurement window and records
the active screen name, dimensions, sample counts, FPS, SIM, RGB, and SDL
milliseconds. Turning the panel off also stops the capture. Packaged platform
adapters can provide the directory through `CALYX_PERF_LOG_DIR`.

## Terminal and headless modes

Start the responsive terminal presenter:

```sh
./play-term.sh
```

The exact 320×240 half-block view uses about 320 columns by 120 rows.
`play-term-clean.sh` forces that exact view. Use the browser player when the
terminal is too small.

Run the launcher without a display:

```sh
python3 tools/catalog.py smoke
```

Build one cart, then run it and write deterministic state:

```sh
npm install --prefix carts/examples/hello-sunny --no-audit --no-fund
python3 tools/dev.py cart hello-sunny
cargo run -p calyx-cli -- run \
  --cart carts/examples/hello-sunny/cart.wasm \
  --frames 120 \
  --out /tmp/calyx-run
```

The output directory contains `status.json`, `frames.jsonl`, and a final PNG.
This proves that one runtime completed the run. Use native and web conformance
to prove parity.

Run the headless SDL performance facsimile for an HD cart:

```sh
npm install --prefix carts/examples/hd-input-lab --no-audit --no-fund
python3 tools/dev.py cart hd-input-lab
cargo run --release -p calyx-cli --no-default-features --features sdl-bundled -- \
  bench-sdl --cart carts/examples/hd-input-lab/cart.wasm \
  --out build/hd-input-lab-sdl-bench.json
```

The command uses SDL's dummy video driver and software renderer, runs 120
warm-up frames followed by 600 measured frames, and reports uncapped mean, p95,
and maximum SIM, RGB, and SDL-path milliseconds. Use it to compare local
implementations under the same host conditions. It does not reproduce a
device's architecture, display driver, memory bandwidth, scheduling, or heat.

## Simulation and presentation rate

Every cart receives exactly 60 `update()` calls per simulation second. Window,
SDL, and browser presenters normally show 60 frames per second. The terminal
normally shows 30 frames per second by presenting the latest framebuffer after
each pair of simulation ticks.

Catalog carts can request `presentation = 30` in `cart.toml`. Native window,
SDL, and browser console presenters apply that preference when the cart starts
and restore 60 Hz for the launcher and boot roles. Carts using the preference
should use Sunny's `run_update_30(process, draw)` so only the displayed ticks
redraw the framebuffer; processing and audio still run at 60 Hz.

The native `--fps` option accepts `30` or `60` for presented runs and overrides
catalog preferences for diagnostics. It does not change simulation speed,
input timing, or tone duration. Headless runs reject `--fps`. The `--frames`
option always counts simulation ticks.

## Direct source commands

The root scripts wrap these catalog commands:

```sh
python3 tools/catalog.py build
python3 tools/catalog.py play-window
python3 tools/catalog.py play-sdl
python3 tools/catalog.py play-term
python3 tools/catalog.py serve-pwa --profile release
```

Cart compilation uses at most four workers by default. Use `--jobs 1` for a
serial diagnostic build, `--jobs N` for another limit, or set
`CALYX_BUILD_JOBS=N` for wrappers.

The native CLI also supports direct presenter selection:

```sh
cargo run -p calyx-cli -- run --cart path/to/cart.wasm --present term
cargo run -p calyx-cli -- run --cart path/to/cart.wasm --present window
cargo run -p calyx-cli --no-default-features --features sdl-bundled -- \
  run --cart path/to/cart.wasm --present sdl
```

## Packages

The package assembler builds the current host's release-profile native package:

```sh
python3 tools/catalog.py dist-native --profile release
```

Linux packages are deterministic `.tar.gz` archives, Windows packages are ZIP
archives containing `calyx.exe` and `catalog/`, and macOS packages are ZIP
archives containing `Calyx.app`. A package includes its catalog, product
metadata, licenses, source directions, and checksums. It does not require Rust,
Node.js, Python, or a separate SDL2 installation.

Build and execute the current host package through the supported verification
workflow:

```sh
python3 tools/dev.py native-release
```

Only run package verification on a trusted package built for the current
operating system and CPU because verification executes its binary. Native
packages are unsigned and not notarized, so operating systems can display an
unknown-publisher warning.

The Flatpak definition builds the Linux x86_64 application ID
`org.cheesycrab.Calyx`. Install a trusted local bundle and run it with:

```sh
flatpak install --user ./calyx-1.0.0-rc.1-linux-x86_64.flatpak
flatpak run org.cheesycrab.Calyx
```

See the [Flatpak component guide](../packaging/flatpak/README.md) for its source
build and sandbox contract.

## Verification

Install web test dependencies, then run the normal repository gate:

```sh
npm ci --prefix web --no-audit --no-fund
python3 tools/dev.py commit
```

The native and web parity commands are:

```sh
cargo run -p calyx-cli -- verify --suite conformance
node web/conform.mjs --suite conformance
```

For browser smoke, install the web dependencies and Chromium, then run:

```sh
cd web
npm ci --no-audit --no-fund
npx playwright install chromium
node smoke.mjs
```

## Workspace cleanup

Show removable build output:

```sh
python3 tools/clean.py
```

Options such as `--cargo`, `--builds`, `--distributions --keep 2`, and
`--node-modules` select targets. Add `--yes` only after checking the list.

## Troubleshooting

- **`cargo` is not found:** install the Rust toolchain.
- **`asc` is not found:** run `npm install --prefix <cart-directory>` or let
  the catalog build install dependencies.
- **A browser device cannot connect:** use the host LAN address and allow the
  local server through the firewall.
- **A controller is not recognized:** use the SDL presenter and pass a mapping
  file with `--controller-db`.
- **Terminal output is clipped:** enlarge the terminal, use the responsive
  wrapper, or switch to the browser.
- **A cart reports a malformed Wasm module:** rebuild `cart.wasm` after source
  changes.

For cart creation, continue with [Cart Authoring](CART_AUTHORING.md).
