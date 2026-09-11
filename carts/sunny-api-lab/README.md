# Sunny API Lab

> **Status:** Implemented interactive Sunny manual in the curated release catalog
> **Category:** Demos · **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.2.0 · Calyx ABI v1.6
> **Release posture:** Maintained public-source manual in the current curated
> player catalog, paired with `hello-sunny` as the copyable starter

## Purpose

Sunny API Lab is the interactive manual for ordinary Sunny carts. Each page
shows AssemblyScript function names, a short contract, controls, and live
output. Diagrams show drawing primitives, measured text, input states, sprite
flips, screen helpers, seeded random values, audio activity, lifecycle counts,
palette colors, and guest-side math values.

Copy `hello-sunny` when you create a cart. Run API Lab when you want to see what
Sunny can do. The launcher icon is a palette-indexed version of the canonical
[`sunny-mark.svg`](../../assets/brand/sunny-mark.svg) SDK mark.

## Lab inventory

The menu covers:

1. indexed canvas drawing and guest-side geometry;
2. ABI text plus Sunny measurement/wrapping helpers;
3. input axes, held/pressed/released edges;
4. baked sprites, transparent color key, flip flags, nearest-neighbor scaling,
   source rectangles, and clipping;
5. width/height and wrapping/clamping screen helpers;
6. seeded `rand`, `rand_range`, and PRNG-state/reset behavior;
7. tones, SFX, drums, sequencer, and stop/start behavior;
8. lifecycle frame count and trace;
9. startup-only palette semantics and custom palette support;
10. scalar ranges, vector dot/normalization/cross, and half-open rectangles.

The Math page runs Sunny code inside the cart. It does not call host math or add
runtime surface. Privileged `calyx.sys`, raw ABI lifecycle plumbing, conformance-only fixtures,
and unsupported APIs are intentionally absent. This cart documents Sunny as
it exists; it does not imitate CartBase where the contracts differ.

## Controls

- **Menu:** Press Up or Down to select a lab. Press A to open it.
- **Lab:** Press Left or Right to change the example when a page has multiple
  views. Press B to return to the index. A page shows an A action only when A
  changes the example.
- **Input lab:** Press B to see its pressed, held, and released states. The lab
  returns to the index one frame after you release B.
- **Audio lab:** Press Start to start or stop the music example.

Each page keeps its API names, contract, and controls visible. The input page
is live. The same buttons operate the lab and show their input states. Traces
record navigation and actions. They do not write duplicate output every frame.

## Verification and maintenance

From the Calyx repository root:

```sh
npm --prefix carts/sunny-api-lab ci
npm --prefix carts/sunny-api-lab run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
```

The canonical feed visits representative primitive, text, input, sprite,
screen, RNG-reset, audio/sequencer, lifecycle, trace, and palette states. When
Sunny's supported ordinary-cart surface changes, update the relevant lab,
this inventory, and its native/web golden together.

The ancestry is Godot's `api_demo_2d` category→function→live-demo shape. All
signatures, contracts, palette behavior, and examples are Sunny-native. Out of
scope: a code editor, exhaustive ABI conformance UI, privileged system-cart
imports, speculative future APIs, and tutorials that require repository docs
to understand the on-screen result.

The launcher icon is derived from the repository's canonical Sunny mark. All lab diagrams, sample output, text, traces, and audio intent are authored in `cart.ts`; the cart loads no external runtime content.

The Sprite page's final two examples show source cropping and a persistent
clip rectangle. The first four use actual nearest-neighbor scaled blits.
This lab keeps indexed output so palette teaching remains literal. Full color
is an independent startup choice, demonstrated by [Sunny API Lab HD](../sunny-api-lab-hd/).
