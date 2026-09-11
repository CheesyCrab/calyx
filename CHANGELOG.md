# Calyx changelog

This file records user-visible Calyx product releases. ABI history remains in [the ABI specification](docs/ABI.md), and individual carts keep their own versions in `cart.toml`.

## 1.0.0-rc.1

- Prepare the first public candidate as `1.0.0-rc.1`, with matching release
  tags and package names. A manual Pages workflow can deploy the exact
  verified web download from a published release.
- Refresh the build toolchain: Wasmtime 48.0.2, AssemblyScript 0.28.20,
  Playwright 1.63.0, and compatible Rust dependency patches. Source builds
  need Rust 1.95 or newer; cart builds and browser tests need Node.js 20 or
  newer and npm 10 or newer. The Calyx ABI remains v1.6.
- Opt-in HD adds 1280×720 presentation; extended digital input adds X/Y/L/R.
  Classic 320×240 and its seven inputs remain the defaults.
- HD carts using Classic input retain their mobile touch controls.
- ABI v1.6 adds opt-in true color at either resolution, source-over alpha,
  source-region sprites, tint, opacity, clipping and supported nearest-neighbor
  scaling. Existing indexed carts retain their drawing contract.
- Build-time PNG conversion can preserve RGBA bytes inside the cart.
- Sunny API Lab demonstrates indexed scaling, cropping and clipping. Sunny API
  Lab HD demonstrates the full-color drawing surface in Side B.

## Initial candidate baseline — 2026-08-25 (unpublished)

The first Calyx release candidate implements ABI v1.4 and the Classic 320×240 console profile.

- Native Rust and browser JavaScript runtimes execute the same portable Wasm carts against shared conformance fixtures.
- Window, SDL, terminal, headless, browser, installable PWA, and touch presenters expose one deterministic 60 Hz simulation.
- Sunny provides AssemblyScript cart lifecycle, indexed drawing, text, input, audio intent, seeded randomness, screen helpers, and bounded guest-side math.
- Boot and Launcher system carts provide console-owned startup and navigation.
- The curated catalog includes maintained games, experiments, a copyable `hello-sunny` example, and the interactive Sunny API Lab.
- Native packages, a Flatpak definition, a self-contained web product, and a Node-only first-cart starter are reproducibly assembled by the release workflow.
- The hosted player validates ordinary-cart imports and resource bounds, runs a locally selected cart in a disposable worker, and does not upload or retain its bytes.

No stable 1.0 release has been published. Release-candidate status describes the implemented product, not a support guarantee or a public roadmap.
