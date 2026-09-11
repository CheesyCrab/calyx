# Calyx Web Runtime and Player

Same carts, smaller luggage: open the browser player and take the console along.
This is also a full JavaScript runtime, so you can inspect what happens between
a cart's button press and its next frame.

This directory contains the JavaScript ABI v1.6 runtime, Node conformance
runner, browser canvas presenter, audio presenter, touch controls, and
installable progressive web app (PWA) shell. It is a peer of the native
[`calyx-core`](../crates/core/) runtime and shares no Rust implementation code.

The DOM-free modules under `src/` run in Node and behind the browser shell.
Indexed/RGBA drawing, clipping, palette identity, the pinned font, input, and
FNV-1a-64 hashing must match the native runtime byte-for-byte. The
[conformance suite](../conformance/README.md) checks that contract.

## Run the browser player

Install Python 3.11 or newer, Node.js 20 or newer, and npm 10 or newer.
From the Calyx repository root:

```sh
./serve-pwa.sh --profile release
```

On Windows, run `serve-pwa.bat --profile release`. Open the URL that the command
prints. See [Running Calyx](../docs/RUNNING.md) for LAN-device testing,
controls, and browser installation limits.

The player boots the curated console at `/`. It accepts Classic controls and
opt-in extended X/Y/L/R controls from the keyboard, a standard Gamepad API
controller, or the
responsive touch deck. The touch deck supports portrait and compact landscape
layouts, visible press feedback, and optional vibration where the browser
provides it. Add `?touchdebug` to show the deck with a desktop pointer.

The Help sheet provides a direct player link, Web Share or clipboard actions,
and a locally generated QR code that remains available offline. No external QR
service receives the URL. Its Advanced view shows source revision, build,
payload, channel, and ABI metadata. A build from uncommitted source displays
`LOCAL`.

The service worker verifies the assembled asset inventory and supports offline
relaunch after a successful install. Browser audio starts only after a user
gesture. Use the sound button to enable or mute it, or add `?audio=off` for a
silent session. Cart changes stop active voices before the next host starts.
Node conformance and browser test mode never create an `AudioContext`.

### Play a local cart

Choose **Upload** at the launcher to try your own cart. A
short interstitial explains local carts and the on-device privacy boundary
before the first file selection in a page session. The loader accepts one
local `.wasm`, identifies it by filename for the current session, and sends no
cart bytes or filename to the network, Cache Storage, IndexedDB, localStorage,
the service worker, or the catalog. Selecting the same rebuilt filename works
again because the file input is cleared after every choice.

Selected carts use the local-cart profile in `src/local-cart-profile.mjs`.
That profile is not a new ABI: trusted bundled carts and cross-runtime
conformance retain their existing path. A selected cart may import exact
ordinary `calyx` functions plus `env.abort`; `calyx.sys`, WASI, imported host
state, unknown functions, wrong signatures, unbounded memory, and excessive
resources are rejected.

The cart executes in `src/local-cart-worker.mjs`. Main-thread watchdogs cover
compilation, instantiation including the Wasm initializer, exported `start()`,
the first frame, and later updates. Home, a trap, a resource violation, or a
timeout terminates the worker and stops audio. The trusted launcher remains
live until validation and frame 0 succeed. The design uses transferable frame
buffers and does not require SharedArrayBuffer or cross-origin-isolation
headers, so it remains compatible with static GitHub Pages hosting.

The local profile admits files up to 8 MiB, initial memory up to 16 MiB, and a
required declared maximum up to 64 MiB. Tables are limited to four, with 4,096
initial and 65,536 maximum entries combined. An update has a 500 ms hang
watchdog; ordinary frame-budget misses are not killed. Trace and tone queues
are bounded synchronously inside host imports before they can grow presenter
allocations, including an aggregate duration budget and a shorter noise cap.

## Directory layout

```text
src/
  audio.mjs          four-channel AudioContext tone presenter
  canvas.mjs         indexed/RGBA framebuffer to canvas presenter
  fnv.mjs            ABI-pinned FNV-1a-64
  font.mjs           built-in font reader
  framebuffer.mjs    clipped indexed/RGBA drawing and source-over blending
  input.mjs          Classic/extended digital input and scripted feeds
  local-cart-client.mjs  main-thread worker protocol and watchdogs
  local-cart-profile.mjs local-file admission rules and resource limits
  local-cart-worker.mjs  disposable ordinary-cart execution worker
  m6x11.mjs          generated browser font data
  palette.mjs        default and per-cart palette state
  presenter-input.mjs keyboard, controller, and touch aggregation
  runtime.mjs        WebAssembly ABI host
  touch-input.mjs    touch ownership, geometry, feedback, and DOM binding
  wasm-metadata.mjs  bounded Wasm signature and limits reader
app.mjs              browser shell and console lifecycle
conform.mjs          Node conformance grader
index.html           browser entry point
product-smoke.mjs    assembled-product and offline browser gate
smoke.mjs            runtime/canvas Chromium gate
touch-smoke.mjs      touch geometry and journey gate
test/                Node unit tests
tools/               generated font and icon tools
```

`src/m6x11.mjs` is generated from the ABI-pinned
[`assets/fonts/m6x11-v1.json`](../assets/fonts/m6x11-v1.json). The browser
module embeds the same data that the native core reads.

## Development commands

Use the prerequisites above. Run these commands from `web/` after
`npm install --no-audit --no-fund`. Conformance and product checks build carts
with the pinned AssemblyScript compiler; the build tools install its npm
dependencies when necessary:

```sh
node --test
node conform.mjs
node smoke.mjs
node product-smoke.mjs --profile release
node touch-smoke.mjs --profile release
node tools/gen-font.mjs
```

`smoke.mjs`, `product-smoke.mjs`, and `touch-smoke.mjs` require Playwright and
Chromium. Install the browser once with `npx playwright install chromium`.

`conform.mjs` builds the conformance carts, runs them through the JavaScript
host, and compares hashes, expected faults, palette and color identity, and event streams
with the same oracle used by native `calyx verify`.

`smoke.mjs` runs a cart in Chromium and checks both the in-browser `run_hash`
and a hash reconstructed from canvas pixels. `product-smoke.mjs` checks the
assembled catalog, root routing, file types, integrity metadata, and offline
lifecycle. `touch-smoke.mjs` checks portrait and landscape geometry, pointer
ownership, feedback, rotation, and representative launcher-to-cart journeys.

## Assemble a web product

From the repository root:

```sh
python3 tools/catalog.py dist-web --profile release
```

The command builds the curated carts and emits a content-addressed web archive
and SHA-256 sidecar. The payload includes license texts, exact cart attribution,
readable JavaScript source, and source directions for the matching repository
revision.

## Publish the player on GitHub Pages

The Pages workflow deploys the web archive attached to a published release.
It checks the archive checksum, every payload file, and the source commit
before uploading anything. There is no second build to drift from the download.

1. Push the release tag matching `tools/product_identity.py` (currently
   `v1.0.0-rc.1`) and let the release workflow finish.
2. Check the draft release's downloads and publish the release when ready.
3. With the repository public, choose **GitHub Actions** as the source under
   **Settings → Pages**.
4. Run **publish verified web release** from the Actions tab, selecting that
   published tag. The deployment job reports the player URL.
5. Open the player, launch a cart, and check an offline relaunch after the
   first successful load.

The workflow skips private repositories and refuses draft releases. Publishing
a tag does not automatically change the live player; run the Pages workflow
again when you want to put a newer release on the shelf.

## Color and sprite drawing

ABI v1.6 retains indexed color by default. A cart can select RGBA8888 during
`start()` independently of the runtime resolution. True-color pixels use
canonical RGBA bytes with opaque output alpha; drawing supports straight-alpha
source-over, RGB tint, opacity, nearest-neighbor scaling and source rectangles.
Both color modes support a persistent clipping rectangle. The host validates
source memory and new drawing arguments even when the destination is clipped.

Canvas and local-cart worker transport preserve the selected format. Local
uploads accept the new ordinary imports and still default to 320×240; choosing
true color does not request HD. PNG decoding remains a build-time asset tool.
