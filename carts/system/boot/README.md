# Calyx Boot

> **Status:** Implemented privileged system cart
> **Category:** Settings / console UI · **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.0.0 · Calyx ABI v1.6 system surface
> **Release posture:** Always included as the console opening ceremony

## Product role

The deterministic console-opening ceremony. On every presenter that fields a
boot role, the console opens here instead of the launcher: it runs in the
verified 320x240 framebuffer, emits verified tone events, and calls the
existing `sys_exit()` at frame 95 to hand control to a fresh launcher. The
launcher then behaves exactly as if the console had opened there directly.

`role = "boot"` is product catalog metadata, not ABI. The role is optional for
backward-compatible catalogs, unique when present, requires `system = true`, is
included in every catalog profile, and is withheld from the launcher-visible
cart list. Presenters run the boot role first when available, then replace it
with a fresh launcher on `sys_exit`; older catalogs without a boot role continue
to open directly on the launcher. A boot fault (load failure or runtime trap)
falls back to the launcher on every presenter; the web player additionally
honors `prefers-reduced-motion: reduce` by skipping the animated cart entirely.

## Interaction

The boot cart is not a playable surface. A newly pressed console control may
skip from frame 56 onward; runner-side input quarantine prevents that press
from leaking into the launcher. Before frame 56 all input is ignored. The cart
always calls `sys_exit()` at frame 95 if no skip occurs.

## Visual and audio language

Final-size pixel masks are generated from the canonical Calyx and Sunny SVG
components in `assets/brand/`. A cheerful Sunny mark blooms from its center:
four petals arrive clockwise like a warm loading spinner, then its rays flare
into place. Four heavier Calyx panels approach on
cardinal rails and assemble around it. Sunny's rays are absorbed back into a
gold center ember, an ignition ring expands, and the
completed exact Calyx mark resolves gold around its SDK heart. A SWEETIE-shaped
custom palette pins the canonical brand fills; the remaining slots stay
SWEETIE-16 so the ceremony reads as the console's own identity.

Along the lower edge, a custom five-glyph pixel mold transforms continuously:
a slightly curved horizontal front sweeps `SUNNY` directly into `CALYX`.
Every 2x2 cell remains on-grid and the baseline stays
stable; “liquid” describes the uninterrupted material handoff, not dripping or
wobbling typography. Sunny remains light 2x2 linework; transformed Calyx cells
gain a third pixel of horizontal and vertical mass, leaving a sturdier word
behind. The four Calyx panels close as opposing structural pairs and snap into
exact alignment without positional shake or recoil. Their weight comes from
the hard final step, paired latch tones, and two dense, staggered
ripple fronts rather than a single hairline circle. Both fronts remain alive
until their clipped side arcs have crossed the wider horizontal edges.
After both locks, Sunny holds for a beat and then compresses into the core.
Gold fills the stationary shell outward through a four-frame diamond front;
the ripples use two two-line fronts, and a fully gold shell skips the redundant
dark-base/recolor pass.

| Phase | Frames | Description |
|---|---|---|
| SUNNY BLOOM | 0-17 | Sunny loads clockwise through four petals, then completes with cardinal and diagonal rays |
| CALYX ASSEMBLY | 18-39 | Opposing panel pairs lock around the full Sunny mark |
| CORE TRANSFER | 40-47 | The locked structure holds, then Sunny contracts evenly into its center |
| CALYX HOLD | 48-95 | Gold and two economical ripple fronts release from the core; the direct identity sweep finishes at 70, leaving a quiet final hold |

Audio events: `blip` at frame 3, `powerup` at 10, paired `hit` latches at
frames 38 and 40, and `fanfare` at 48. The exact frame and event stream are pinned by the
conformance golden vectors.

## Deterministic implementation model

The cart is a pure function of (frame, input, cart state). No wall clock, host
RNG, or file reads. Logo geometry is compile-time span tables generated from
SVG; cardinal rotation preserves exact pixel topology via integer run-length
transforms. Sunny uses a dedicated 112x112 raster generated directly from the
canonical vectors, avoiding the uneven row collapse caused by runtime scaling;
Calyx panel motion uses low-step integer easing.
Subpixel state is integer-only. The `any_pressed()` skip gate is
the only input consumer; it never affects the framebuffer before frame 56.

## Build and verification

From the Calyx repository root:

```sh
npm --prefix carts/system/boot ci
npm --prefix carts/system/boot run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
python3 tools/catalog.py smoke
```

The conformance fixture is a thin wrapper that re-exports the product source;
it pins the framebuffer progression, latch/core audio events, traces, and the
exact `sys_exit` frame across native and web. Catalog smoke boots the boot
cart, follows `sys_exit` to the launcher, and confirms at least one catalog
swap.

## Asset regeneration

The logo span tables in `logo_assets.ts` are generated from
`assets/brand/calyx-mark.svg` and `assets/brand/sunny-mark.svg` by
`build_logos.mjs`, which rasterizes the full marks at 204x204 and the animated
Sunny components at 112x112 in a headless browser, then encodes opaque pixels as
`(y, x0, x1)` runs. Regenerate after a brand mark change:

```sh
node carts/system/boot/build_logos.mjs
```

## Scope

The boot cart is a system cart only because it calls `sys_exit()`. It does not
own catalog assembly, release curation, persistence, downloads, installation,
accounts, or host UI. It does not read files, wall time, presenter dimensions,
or network state. The replay button in the web player header is a presenter
affordance, not a boot-cart feature. This README is authoritative for the boot
cart itself.
