# hello-sunny: start here

> **Status:** Implemented authoring example and non-game cart in the curated release catalog
> **Category:** Demos · **Author:** Cheesy Crab
> **Version / ABI:** Cart 0.2.0 · Calyx ABI v1
> **Release posture:** Maintained public-source example in the current curated
> player catalog. Generated carts must opt into either decision deliberately.

This is the standard working Sunny template. You can read the source in one
sitting. It shows lifecycle callbacks, state initialization, deterministic
animation, discrete vector movement, scalar bounds, drawing, text, sound, and
tracing.

## What the example does

`start()` resets all cart state. The first update writes a ready trace to the
verified event stream. Use the D-pad to move the Sunny mote. Press A to emit a
pulse, increase the counter, play a sound, and trace the action. Press B to
reset the position and pulse.

The cart draws the mote, two guide beams, control labels, and a live state
strip. Search `cart.ts` for `CUSTOMIZE` to find safe first edits. You can change
the title, speed, colors, controls, and shape.

The mote position is a `Vec2i` because screen pixels are discrete. The movement
step reuses a second `Vec2i` and applies one operation to both axes without
allocating per frame. `clamp<i32>` applies the visible screen bounds explicitly.
Use `Vec2` instead when a cart needs continuous guest-side motion, then
quantize before an integer draw call.

This cart is a lifecycle example. It is not a complete API list. Run Sunny API
Lab for an interactive API tour. Use the conformance suite to verify the host
contract.

To create a cart from it, run this from the Calyx root:

```sh
python3 tools/new_cart.py my-first-cart \
  --name "My First Cart" \
  --author "Your Name"
```

The generator writes `carts/my-first-cart/` and sets the correct Sunny import.
It does not add the cart to the release catalog. It also sets
`public_source = false`. Open the generated `cart.ts`, and search for
`CUSTOMIZE`.

Do not copy this nested directory. A product cart uses a different relative
path to Sunny. The generator sets that path.

## Build

From this directory:

```sh
npm ci --no-audit --no-fund
npm run build
```

The build writes `cart.wasm` next to `cart.ts`. `calyx console` expects this
layout.

To check the example in the developer catalog, run from the Calyx repository root:

```sh
python3 tools/catalog.py build
python3 tools/catalog.py smoke
```

The checked-in deterministic input feed tests movement, A, B, and both screen
bounds. To build the cart, replay the feed, and verify the trace and audio
events, run from this example directory:

```sh
npm run check:demo
```

## Run

From the Calyx repository root:

```sh
cargo run -p calyx-cli -- run \
  --cart carts/examples/hello-sunny/cart.wasm \
  --present window
```

Use arrows or WASD to move, Z for A, and X for B. Escape closes the window.
For interactive terminal play, run `python3 tools/catalog.py play-term`
from the Calyx root and select **Demos → hello-sunny**.
`calyx run --present term` displays a fixed replay; it does not read live keys.

If `calyx` is installed on your `PATH`, the same command starts with
`calyx run` instead of `cargo run -p calyx-cli -- run`.

## Watch

From the Calyx repository root:

```sh
cargo run -p calyx-cli -- watch \
  --cart carts/examples/hello-sunny/cart.wasm \
  --src carts/examples/hello-sunny/cart.ts \
  --build "npm --prefix carts/examples/hello-sunny run build" \
  --present window
```

Edit `cart.ts`. The watcher rebuilds the cart and reloads it from frame 0. Point
`--src` at the source file. Do not point it at the directory because that
directory also contains `cart.wasm`. Watching `cart.wasm` causes a build loop.

## Determinism and scope

Keep the generated cart deterministic. Use `frame()` for time. Use Sunny's
seeded pseudo-random number generator (PRNG) for random values. Use integers for
discrete state. Use finite-domain guest-side `f64` only when continuous math
needs it. Use only ordinary-cart imports. A new manifest
does not set `release = true`, and it sets `public_source = false`.

Out of scope for this example: privileged `calyx.sys`, persistence, networking,
assets, complex architecture, production error handling, and demonstrations of
every Sunny helper. Add only what the new cart actually needs; do not grow the
template into a framework.

All visible geometry, text, and tones are authored directly in `cart.ts`; the example has no external art, audio, data, or third-party content.
