# Sunny API Lab HD

Sunny API Lab HD is the interactive drawing companion to [Sunny API Lab](../sunny-api-lab/).
It runs at 1280×720 and selects true color once in `start()`. The same drawing
API also works at 320×240. Cart version 1.0.0 requires Calyx ABI v1.6.
It is public source and is not selected for the curated release catalog.

## Controls and pages

Press Left or Right to change the topic. Press A to toggle its example.
Press B to return to the first topic. Each navigation action emits a
`drawing-lab page=N variant=N` trace; pages and variants are zero-based.

1. **Full color:** RGB ramps, packed `rgba`, rectangles, pixels, and opaque clear.
2. **Alpha compositing:** overlapping translucent panels and text. A reverses draw order.
3. **PNG inside the cart:** the embedded RGBA sheet at 1:1 and a scaled badge.
   A selects the other badge.
4. **Tint + draw opacity:** one sprite with white, warm, and cool tints.
   A switches opacity between 255 and 96 while preserving per-pixel alpha.
5. **Regions + scaling:** source crops, nearest-neighbor scaling, X/Y flips,
   and tinted translucent indexed sprites. A toggles the flips.
6. **Clipping rectangles:** RGBA and indexed draws share a panel scissor.
   A disables the scissor. `reset_clip()` restores drawing outside the panel.

Clear ignores the scissor. Source assets use straight-alpha RGBA bytes;
the framebuffer stays opaque. No filtering, rotation, custom blend modes,
offscreen surfaces, or runtime asset loading are demonstrated or required.

## Build and verification

From the Calyx repository root:

```sh
npm --prefix carts/sunny-api-lab-hd ci
python3 tools/dev.py cart sunny-api-lab-hd
cargo run -p calyx-cli -- verify
node web/conform.mjs
```

To try it, run `python3 tools/catalog.py play-window --profile dev` and select
**Demos → Sunny API Lab HD**. The catalog supplies the HD display metadata.

After editing `badges.png`, regenerate its embedded source before rebuilding:

```sh
python3 tools/png2src.py carts/sunny-api-lab-hd/badges.png --format rgba --name BADGES -o carts/sunny-api-lab-hd/badges.ts
python3 tools/dev.py cart sunny-api-lab-hd
```

The shared native/web conformance tour visits each page and its alternate
example. Visual review checks text layout and the clipping, alpha, tint,
source crop, and flip examples in both runtimes.

## Provenance

All demonstration code and text are authored for this cart under
GPL-3.0-or-later. `badges.png` is an original procedural 32×16 demonstration
sheet with two 16×16 badges, deliberately including partial and zero alpha.
`generate_badges.py` reproduces it using only Python's standard library.
`badges.ts` is generated from that PNG by the repository converter. The icon
is the same canonical Sunny mark used by Sunny API Lab. There are no external
runtime assets, third-party artwork, or filesystem imports.
