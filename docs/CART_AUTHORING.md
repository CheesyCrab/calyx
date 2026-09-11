# Calyx Cart Authoring

Make a small change, build a Wasm file, and put it in the player. That's the
first loop. This guide takes you from there to sprites, catalog entries, and
repeatable tests using Sunny, Calyx's AssemblyScript SDK.

Keep the [Sunny API reference](../sdk/README.md) nearby for individual functions.
[The ABI](ABI.md) has the exact cart/runtime rules when you need them.

## Start with the downloadable starter

Building from an extracted starter needs Node.js 20 or newer and npm 10 or
newer. The starter build itself does not need Rust or Python.

Download `calyx-cart-starter-1.0.0-rc.1.zip` from
[the release page](https://github.com/CheesyCrab/calyx/releases).
To build the same starter from the Calyx source root, run
`python3 tools/starter_package.py` to assemble the ZIP with its pinned Sunny
source. Start the local browser player with `./serve-pwa.sh --profile release`
(or `serve-pwa.bat --profile release` on Windows) to test your cart. See
[Running Calyx](RUNNING.md) for source prerequisites.

The assembled browser player's Help panel also includes the starter.
Extract the ZIP, open a terminal in `calyx-cart-starter`, and install the exact-pinned
AssemblyScript compiler once:

```sh
npm install
```

Open `cart.ts` and search for `CUSTOMIZE`. Make one change, then build:

```sh
npm run build
```

The command writes `cart.wasm` and tells you which file to select. Return Home
in the browser player, choose **Upload**, read the local-cart explanation, and select that file. Rebuild
and select the same filename for each revision. The player reads the file on
the device; it does not upload, cache, catalog, or remember the cart.

The ZIP includes the matching Sunny source; `npm install` downloads
AssemblyScript and its compiler dependencies.
Its build declares the memory ceiling required by the hosted local-cart
profile. The resulting Wasm remains a normal ABI v1 cart and runs unchanged in
the native runtime.

The hosted player applies generous safety limits to selected local files. They
are presenter admission rules, not ABI limits:

| Resource | Hosted local-cart limit |
|---|---:|
| Wasm file | 8 MiB |
| Initial memory | 16 MiB |
| Declared maximum memory | 64 MiB |
| Function tables | Up to 4; 4,096 initial and 65,536 maximum entries combined |
| Compilation | 10 seconds |
| Initialization / `start()` | 2 seconds each |
| One `update()` | 500 milliseconds |
| Trace | 4 KiB per message; 64 KiB per frame |
| Tone calls | 32 per frame; 60 seconds combined; noise 10 seconds per call and combined |

Missing a 16.7 ms frame is not a fault. The update watchdog catches an obvious
hang. A failure terminates the disposable guest, stops its audio, and returns
to the trusted launcher so you can select a rebuilt file.

## Work in the full source repository

Use the repository workflow when you want native presenters, headless dumps,
catalog integration, asset tools, or cross-runtime conformance.

### Prerequisites

- Install Python 3.11 or newer for the cart and catalog tools.
- Install Node.js 20 or newer and npm 10 or newer. Each cart installs its own AssemblyScript compiler
  (`asc`) as a development dependency. Do not install `asc` globally.
- Install Rust 1.95 or newer and Cargo, or put an installed `calyx` binary on `PATH`.
- To run browser tests, install the web dependencies and Chromium. From
  `web/`, run `npm ci --no-audit --no-fund`. Then run
  `npx playwright install chromium` once.
- Run commands from the repository root unless the guide says otherwise.
- Rebuild `cart.wasm` after you edit the source. Git does not track this file.
  Otherwise you will still be playing the previous build.

The examples use the repo-local CLI form:

```sh
cargo run -p calyx-cli -- <command>
```

If you installed the binary, replace that prefix with `calyx`.

### Generate from hello-sunny

[`hello-sunny`](../carts/examples/hello-sunny/) is the standard working starter.
Its small `cart.ts` shows lifecycle, drawing, input, sound, animation, and
tracing. The generator adjusts its paths for your new cart, so you can skip
the copy-and-fix-imports dance.

```sh
python3 tools/new_cart.py my-first-cart \
  --name "My First Cart" \
  --author "Your Name"
npm install --prefix carts/my-first-cart --no-audit --no-fund
npm run --prefix carts/my-first-cart build
```

Run [`Sunny API Lab`](../carts/sunny-api-lab/) when you need more examples. It
is the interactive manual for drawing, text, input, sprites, screen helpers,
random numbers, audio, lifecycle, and palettes.

The generator creates the directory, npm package, and manifest. It also sets
the correct import from the public `sdk/assembly/index` source tree. That source
is the checkout-local form of the `@cheesycrab/sunny` package. A new cart is
not in the release catalog.

The repository generator's default cart license is `GPL-3.0-or-later`. To
select another SPDX license expression, use `--license`. The license covers
the cart code, text, art, audio, generated data, and compiled Wasm. Identify
third-party material separately.

The build writes:

```text
carts/my-first-cart/cart.wasm
```

Open `carts/my-first-cart/cart.ts`. Search for `CUSTOMIZE`, and make one small
change. The generated import already points to Sunny from the correct cart
location.

A cart directory should contain:

```text
cart.ts       # Sunny source
cart.toml     # metadata, including the author-selected whole-cart license
cart.wasm     # built portable artifact
package.json  # build script and AssemblyScript dependency
icon.bin      # optional 64x64 palette indices for the launcher
```

## Run without a display or in the terminal

To run without a display and write a state dump:

```sh
cargo run -p calyx-cli -- run \
  --cart carts/my-first-cart/cart.wasm \
  --frames 120 \
  --out /tmp/hello-sunny-dump
```

If the run succeeds, the command prints `ran 120 frames →
/tmp/hello-sunny-dump (run_hash <16 hex>)`. It writes three files to the output
directory:

- `status.json` — `run_hash`, `final_hash`, `frames_run`, and the
  profile (size + palette). The `cart` field is the wasm path stem, not
  the `cart.toml` name.
- `frames.jsonl` — one line per simulation tick: `f`, `hash`, `btn`, `audio`,
  `trace`.
- `frame_NNNN.png` — the final frame only (one PNG, not per-frame).

This dump confirms that the cart ran without a fault. It does not prove runtime
parity. The shared conformance suite checks runtime parity; it does not automatically
exercise your new cart. Use `calyx verify` and `node web/conform.mjs` to run it. Do not compare
run hashes from runs with different frame counts.

To preview a deterministic run in the terminal (no live keyboard input):

```sh
cargo run -p calyx-cli -- run \
  --cart carts/my-first-cart/cart.wasm \
  --present term \
  --frames 120
```

Every cart runs at exactly 60 simulation ticks per second. The terminal shows
30 frames per second by default. The window and SDL players show 60 frames per
second by default. The `--fps` option accepts only `30` or `60`. It does not
change movement, timers, input feeds, or audio duration. The `--frames` option
always counts simulation ticks.

A catalog cart may instead set `presentation = 30`. Pair that preference with
Sunny's `run_update_30(process, draw)`: input, gameplay, timers, and music still
advance on all 60 ticks, while `draw` runs on even-numbered cart frames only.
An explicit native `--fps` remains a diagnostic override.

To run in a window:

```sh
cargo run -p calyx-cli -- run \
  --cart carts/my-first-cart/cart.wasm \
  --present window
```

A window run continues until you close it or press Escape; it ignores
`--frames` and `--out`. A direct terminal run defaults to 30 simulation frames.
Pass `--frames N` for a longer terminal run, or use the interactive catalog
terminal wrapper described in [Running Calyx](RUNNING.md).

In the window or interactive catalog terminal, use the arrow keys or WASD to
move. Press `Z` for A, `X` for B, and Enter for Start. In console mode, press
Backspace to return to the launcher. Press Escape to quit.

## Watch while you edit

`calyx watch` needs the source path and the build command:

```sh
cargo run -p calyx-cli -- watch \
  --cart carts/my-first-cart/cart.wasm \
  --src carts/my-first-cart/cart.ts \
  --build "npm --prefix carts/my-first-cart run build" \
  --present term
```

Point `--src` at the source files. You can also use a directory that does not
contain `cart.wasm`. Do not watch the directory that receives `cart.wasm`.
Otherwise, each build starts another build loop.

Each reload starts at frame 0. This behavior makes a watched run match a fresh
verification run.

## Add the cart to the console

`calyx console` reads one directory that contains one subdirectory for each
cart. Each cart subdirectory must contain `cart.toml` and `cart.wasm`. A
developer cart can omit `icon.bin`. A release cart must include it.

The checked-in source includes boot, launcher, and Settings system carts. Build and assemble it with:

```sh
python3 tools/catalog.py build
```

This command writes the native console to `build/catalog/`. It automatically
includes each runnable cart under `carts/<slug>/`. You do not need to copy or
install the cart manually.

The scaffolder writes `public_source = false`. This is repository contribution
metadata: change it to `true` only when the cart is accepted as maintained
public source. `release = true` separately opts a cart into the player catalog
and requires `public_source = true`; maintained examples may set only
`public_source = true`.

To open the console in a window, run:

```sh
cargo run -p calyx-cli -- console \
  --carts build/catalog \
  --present window
```

The catalog tool defaults to the developer profile, which includes every
runnable cart under `carts/`, including examples and work in progress. To build
the curated player catalog, run:

```sh
python3 tools/catalog.py build --profile release
```

This selects release-enabled system roles and carts, validates the release
metadata and 4096-byte icons, and writes `build/release/`. Pass that directory
to `calyx console --carts` to play it. Keep the developer catalog for development.

The boot role runs before the launcher. The launcher does not show itself or
other system roles in its cart list.
The setting `system = true` grants privileged `calyx.sys` imports. Do not use
this setting for an ordinary cart.

For a no-display or continuous integration (CI) run, use `--present headless`.
Also supply `--frames` and an input feed with `--in`:

```sh
cargo run -p calyx-cli -- console \
  --carts build/catalog \
  --present headless \
  --frames 60 \
  --in /tmp/calyx-console-feed.json
```

A successful run prints `console: booted launcher (N carts)` and then
`console: done (M swaps)`. Add `--out <dir>` to write PNG snapshots and a small
`status.json` file. The output always includes the final frame. Use `--every N`
to include each Nth frame.

### Exiting a game back to the launcher

In a window, press Backspace to return to the launcher. The host handles this
action, so the cart does not need code for it. Press Escape to quit the player.
System carts can also call `sys_exit`.

A no-display input feed has no Backspace action. Only a system cart can script
a return to the launcher by calling `sys_exit`. An ordinary cart continues
until the input feed ends the run.

### `cart.toml` fields

| field | required | meaning |
|---|---|---|
| `name` | yes | shown in the launcher |
| `author`, `version` | no | used for list display when present |
| `license` | release carts | SPDX expression for the whole cart; generated carts default to `GPL-3.0-or-later` |
| `entry` | no | AssemblyScript source (build input, not read by the runtime) |
| `abi` | no | ABI line (`"v1"`); see `conformance/README.md` for dialects |
| `category` | no | launcher group; defaults to `Games` (31 UTF-8 bytes max) |
| `display` | no | `classic` (default) or the Dev/Side B fixed `hd` 1280x720 profile |
| `input` | no | `classic` (default) or the Dev/Side B `extended` X/Y/L/R digital profile |
| `presentation` | no | `60` (default) or `30`; presenter cadence only, simulation remains 60 Hz |
| `release` | no | `true` opts the cart into the strictly validated release catalog |
| `public_source` | yes | repository contribution metadata; `true` keeps the cart in the maintained public source tree |
| `system` | no | `true` grants privileged `calyx.sys` imports at link time |

HD, extended input, and presentation cadence are catalog capabilities. The
local-cart upload profile remains Classic at 60 Hz because a bare Wasm file
carries no manifest.

If you see `failed to parse WebAssembly module`, rebuild the cart and check
that the selected file is the new `cart.wasm`. An incomplete or invalid Wasm
file cannot load; a stale but valid one simply runs your old code.

## Add sprites and icons

Calyx uses indexed pixels by default and supports opt-in RGBA drawing. The runtime does not load PNG files. Convert sprites
and include the converted data in the `.wasm` file.

Convert a PNG into an AssemblyScript module:

```sh
python3 tools/png2src.py path/to/sprite.png \
  --name HERO \
  -o carts/my-first-cart/hero.ts
```

Import the generated `HERO`, `HERO_W`, and `HERO_H` constants. Then draw the
sprite with `blit_sprite(HERO, HERO_W, HERO_H, x, y, flags)`.

`png2src.py` maps colors exactly. Each opaque pixel must match the selected
palette. A transparent pixel with alpha less than 128 becomes index 0. If the
tool reports a color error, it identifies the pixel and color. Fix the source
PNG, or use `--palette` or `--palette-file`. Run `png2src.py --help` to see all
options and named palettes.

### `blit_sprite` flags

`flags` is a bitset. The default value `0` draws every pixel, including index
0. A transparent sprite with `flags = 0` therefore paints its transparent areas
with palette index 0 (black in the default palette).
Import the named constants from Sunny and combine them with the OR operator:

```ts
import { blit_sprite, FLIP_X, FLIP_Y, COLOR_KEY } from "../../sdk/assembly/index";

// plain transparent sprite — index 0 pixels are skipped:
blit_sprite(HERO, HERO_W, HERO_H, x, y, COLOR_KEY);
// flipped horizontally + transparent:
blit_sprite(HERO, HERO_W, HERO_H, x, y, FLIP_X | COLOR_KEY);
```

| constant | value | effect |
|---|---|---|
| `FLIP_X` | 1 | mirror horizontally |
| `FLIP_Y` | 2 | mirror vertically |
| `COLOR_KEY` | 4 | skip index-0 pixels (transparency) |

### The default palette

The default palette is **SWEETIE_16** (Calyx's variant — index 0 is
`#000000`, index 1 is `#ffffff`; this is not the public GrafxKid
order). Your sprite's opaque pixels must match one of these exactly:

| idx | hex | | idx | hex |
|---|---|---|---|---|
| 0 | `#000000` | | 8 | `#38b764` |
| 1 | `#ffffff` | | 9 | `#257179` |
| 2 | `#1a1c2c` | | 10 | `#29366f` |
| 3 | `#5d275d` | | 11 | `#3b5dc9` |
| 4 | `#b13e53` | | 12 | `#41a6f6` |
| 5 | `#ef7d57` | | 13 | `#73eff7` |
| 6 | `#ffcd75` | | 14 | `#94b0c2` |
| 7 | `#a7f070` | | 15 | `#566c86` |

The other named palettes (`GAMEBOY`, `GBA_WARM`, `MONO`) are listed in
`png2src.py --help` / `tools/png2src.py` source.

### Launcher icons

A launcher icon is an optional `icon.bin` file. It contains exactly 4096 bytes
of row-major 64×64 palette indices. `png2src.py` does not have an icon mode. During development, you
can omit `icon.bin` and use the launcher placeholder. Release carts need an icon.

To create an icon manually, write 4096 bytes of palette indices. You can map a
64×64 PNG through `png2src.py` and keep its index array. Index 0 is transparent.
Use a nonzero background index for a solid icon. To inspect the icon without a
window, run the no-display console with `--out <dir>` and open the PNG output.

## Verify your cart

Run the checks from the repository root. Each row shows the expected success
output.

For a quick build, run `python3 tools/dev.py cart <name>`. This command checks
the cart metadata and builds the selected cart. It does not run a targeted
conformance test because `calyx verify` grades the full suite. Use the checks
below when you must verify behavior or runtime parity.

The broader workflows are `commit` and `release`. Run
`python3 tools/dev.py --dry-run <workflow>` to see their commands.

| surface | command | green |
|---|---|---|
| native conformance | `calyx verify` | `core: <suite count> pass, 0 fail, 0 skip` |
| web conformance | `node web/conform.mjs` | `web: <suite count> pass, 0 fail, 0 skip` |
| browser smoke | `node web/smoke.mjs` | `smoke: PASS` |
| no-display run | `calyx run --cart <wasm> --frames N --out <dir>` | `ran N frames → <dir> (run_hash …)` |
| console chainload | `calyx console --carts <dir> --present headless --frames N --in <feed>` | `console: booted launcher (N carts)` / `console: done (M swaps)` |

`calyx verify` grades the conformance suite against the native runtime.
`node web/conform.mjs` reproduces the same hashes in the web runtime. The two
hash sets must match exactly.

`node web/smoke.mjs` uses Playwright and Chromium. It checks the browser
`run_hash` and a hash of the canvas pixels. Install Chromium with
`npx playwright install chromium`. The command reports an error if Playwright
or Chromium is not available.

Common local setup failures:

- **`asc` is missing:** Run `npm install` for the cart. It provides `asc`.
- **`cargo` is missing:** Install Rust before you use the
  `cargo run -p calyx-cli -- …` command.
- **The Playwright browser is missing:** From `web/`, run
  `npx playwright install chromium` before `node smoke.mjs`.
- **`cart.wasm` is stale:** Rebuild it after you edit the source.
- **The working directory is wrong:** Run cart commands from the repository
  root because the cart paths are relative to that directory.

## Follow the determinism rules

Verified carts must replay the same way on every runtime:

- Use `frame()` as the clock. Do not read wall time.
- Use Sunny's `seed()` / `rand()` helpers for randomness.
- Keep gameplay integer or deterministic fixed-point when possible.
- Do not use host IO, network, files, or platform APIs from cart logic.
- `use_palette()` / `set_palette` is start-only. Mid-run palette swaps are
  not part of ABI v1.
- Treat audio as intent: `tone` / `sfx` calls are verified as events;
  speaker output is presenter-side.

The portable artifact is `cart.wasm`. If it needs extra files to play, it is
not a Calyx v1 cart yet.

## Full-color drawing

Indexed color remains the default at either resolution. To select true color,
call `use_true_color()` once from your startup callback, before drawing. The
choice is embedded in the Wasm cart; it needs no external color configuration.
Existing palette-based Sunny drawing functions remain usable in the same cart.

```ts
import {
  run_start, run_update, use_true_color, clear_rgba, rgba, rgba_rect,
  clip_rect, reset_clip,
} from "../../sdk/assembly/index";

function ready(): void { use_true_color(); }
function process(): void {}
function draw(): void {
  clear_rgba(rgba(24, 30, 45));
  clip_rect(20, 20, 180, 100);
  rgba_rect(0, 0, 160, 100, rgba(230, 110, 45, 160));
  reset_clip();
}
export function start(): void { run_start(ready); }
export function update(): void { run_update(process, draw); }
```

To embed a PNG with its colors and alpha intact, run:

```sh
python3 tools/png2src.py artwork.png --format rgba --name ART -o art.ts
```

Import the emitted byte array and dimensions into the cart. Draw them with
`blit_rgba` or `blit_rgba_region`. The PNG is decoded during the build workflow;
its RGBA bytes compile into `cart.wasm`. The runtime has no PNG decoder or
filesystem requirement. Omit `--format rgba` to retain exact indexed palette
conversion and the original color-key behavior.

Sunny supports nearest-neighbor sprite scaling, source rectangles, clipping,
RGB tint and draw opacity. Tint and opacity compositing require true-color
output. Use [Sunny's reference](../sdk/README.md) for signatures and
[the ABI](ABI.md#true-color-and-compositing-v16) for rounding and validation.
[Sunny API Lab](../carts/sunny-api-lab/README.md) demonstrates indexed drawing;
[Sunny API Lab HD](../carts/sunny-api-lab-hd/README.md) demonstrates full color.
