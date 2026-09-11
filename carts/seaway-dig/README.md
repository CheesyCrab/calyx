# Seaway Dig

> **Status:** Implemented and opted into the current curated release catalog
> **Category:** Games
> **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.0.0 · Calyx ABI v1

## Purpose

Dig the southern half of the Serian Seaway from Tlilcaida to the Strait. The
player cuts through a 60×120 terrain field one tile at a time while a growing
crew claims nearby work, water floods the opened channel, and waiting barges
become moving proof that the route works. Reaching the Strait is only the first
milestone: the narrowest row must be widened to five water tiles before the
Seaway is complete.

This is a small, complete canal-digging game: make a cut, put the crew to
work, and enjoy the improbable satisfaction of a barge getting through.

## Play loop

1. Begin in Tlilcaida with three workers and idle river barges.
2. Walk into terrain to dig it. Dirt and salt clear quickly; rock is slow.
3. Cleared four-neighbor space floods immediately from existing river or
   Strait water.
4. Workers follow the player and prefer unique exposed tiles within four
   tiles. When all nearby work is claimed, up to three workers team on one
   tile with diminishing returns.
5. A manual completion that lands the shared cleared-tile count on a multiple
   of twenty hires one worker, up to thirty.
6. Cross five geographic zones, using the minimap or pausable overview to read
   the cut.
7. Connect river water to row 2 to trigger **THE WATERS MEET!**.
8. Widen every intervening row until the bottleneck reaches five tiles.
9. Continue excavating and exploring after completion. The player and crew can
   clear as much of the remaining world as desired while barges continue
   through the finished canal.

There is no loss state and no separate win screen. Completion changes the
world and leaves the player inside it; it is a milestone, not an endpoint.

## Controls and states

| Context | Input | Action |
|---|---|---|
| Title | A | Reset and begin |
| Title | Start | Open the two-page help |
| Help | A / Start | Advance; page two returns to title |
| Help | B | Return immediately to title |
| Dig view | D-pad | Move through water/empty space or dig contacted terrain |
| Play (either view) | A | Toggle crew between four-tile **ROAM** and immediately adjacent **CLOSE** work |
| Dig view | Start | Open the overview centered near the player |
| Overview | Up / Down | Scroll the full canal |
| Overview | Start | Return to the dig view |
| Play | B | Toggle the public 5× dig-speed/debug overlay |

The dig view locks player input during a 40×30-tile room transition. Workers
and flooding continue during the slide. The overview pauses player and worker
labor, but barges and UI timers continue.

## World and rules

The 60×120 map runs south to north, with row 0 at the top of the screen:

| Zone | Rows | Terrain mix | Dig multiplier |
|---|---:|---|---:|
| Tlilcaida | 84–119 | 85% dirt · 15% rock | 1.0× |
| The Kraparch | 54–83 | 80% salt · 20% rock | 0.9× |
| Coastal Mountains | 30–53 | 60% rock · 40% dirt | 0.7× |
| Coastal Plain | 12–29 | 90% dirt · 10% rock | 1.2× |
| The Strait | 0–11 | 95% salt · 5% rock | 1.0× |

The bottom three rows are river water; the top two are Strait water. A 5×3
starting pocket is cleared above the river. Base dig times are 0.20 seconds for
dirt, 0.15 for salt, and 0.80 for rock before zone/debug multipliers.

Workers have `FOLLOW → WALKING → DIGGING` states, a 40 px catch-up bubble,
64 px soft leash, two-second away-from-player commitment window, and 160 px
follow-state teleport threshold. Dirt takes two worker-seconds, salt 1.5, and
rock eight before zone modifiers. Workers prefer unique targets; only when no
unclaimed nearby work remains may two helpers join a claimed tile. Two workers
produce 1.7× labor and three produce 2.2×. Worker-cleared tiles count toward the
shared total but never run the hire check; only a manual dig that finishes
exactly on a twentieth total tile can hire. Yes, timing your own dig around the
crew can affect hiring. The default **ROAM** mode searches the full four-tile work area;
**CLOSE** restricts claims to the eight cardinal and diagonal tiles immediately
surrounding the player and releases any more distant assignment when selected.

Barges recalculate the bottleneck every 120 frames. Opening the waters releases
the three boats already waiting in Tlilcaida before new traffic spawns, with up
to two departures per pulse. Moving traffic grows toward
`min(bottleneck × 3, 20)`, prefers nearby water biased toward the center, and
wraps from the Strait back to the river.

## Presentation and audio

The dig view uses a fixed 32-color Seaway palette: SWEETIE-16 remains intact in
indices 0–15 for UI compatibility, while cart-local water, earth, salt, stone,
timber, rust, and lamp ramps occupy the upper bank. Terrain tiles carry
material-specific strata, crystals, edges, and chips. The canal uses a quiet,
uniform midwater field with sparse world-anchored vertical current dashes
traveling north instead of alternating dark tiles or horizontal bands. Workers
read as compact helmeted figures, the foreman uses an animated indexed sprite,
and directional barges have hulls, decks, cabins, cargo, and wake frames. The
canal minimap remains 20 pixels wide. Camera movement is screen-to-screen rather than a
continuous follow camera.

Zone names hold in the center for 90 frames, then follow a 48-frame quadratic
two-axis settle into a font-measured right-aligned HUD position. Milestones pop
into a forty-pixel dithered black band, hold, and fade. Completion owns a
separate large hold, compact upward settle, and persistent banner below the
top HUD row; it never
draws concurrently with the milestone overlay. Overview labels receive an
indexed black backing for legibility and stay out of the reserved objective
and footer band. Its scroll indicator has a separate right-edge lane from the
bottom control footer.

The cart uses a deterministic drum loop, hit punctuation, barge/progress
effects, and fanfares for connection and completion. Audio is part of the
verified event stream. When several workers occupy the same world tile, the
dig view draws one representative figure there; the HUD continues to report
the full crew count, avoiding an unreadable sprite pileup.

## Deterministic implementation

`cart.ts` uses integer frames and pixel-sixtieth positions. Source speeds of
80, 50, 120, 20, and 600 px/s therefore advance exactly at 60 Hz without a
wall clock. Terrain and decorative choices use Sunny's seeded PRNG. Flooding
is a dirty-triggered breadth-first fill. Alpha-like presentation uses palette
steps and ordered dithering; the palette is fixed once at startup, and the cart
does not require alpha, mutable palettes, raw framebuffer access, or host math
imports.

The current movement adaptation resolves simultaneous player axes as an
orthogonal staircase so excavated tiles remain four-neighbor connected.
Worker steering and distance thresholds use bounded integer approximations.
Those are deliberate Calyx implementation differences, not claims of
frame-identical Godot trajectories.

## Verification and visual review

Build the cart from the Calyx root:

```sh
npm --prefix carts/seaway-dig ci
npm --prefix carts/seaway-dig run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
```

The canonical public-input feed is
`conformance/carts/seaway-dig/seaway-dig.in.json`. It runs 10,600 frames with
no verifier-only state mutation, opens help, uses public 5× debug digging,
visits the overview, connects the waters, widens bottleneck `1 → 5`, completes,
and exercises post-completion traffic. Load-time assertions pin zone
thresholds, dig timing, easing endpoints, diminishing team labor, target
staffing limits, and barge tie-breaking.

For Calyx-native visual QA, run the feed headlessly to the listed final frames
with `calyx run --out <dir>` and inspect the resulting `frame_NNNN.png`:

| Frame | Expected checkpoint |
|---:|---|
| 427 | Kraparch label begins centered; no HUD collision |
| 541 | Label is visibly moving in both X and Y |
| 565 | Label rests right-aligned without a snap or clipping |
| 2398 | Waters-meet milestone appears once inside its own band |
| 1080 / 10200 | Overview labels, objective, scroll marker, and footer do not overlap |
| 8691 | Completion banner appears once; no duplicate milestone text |
| 8840 | Compact completion label is moving upward |
| 8871 | Persistent completion label has settled without colliding with HUD text |

Example for one checkpoint after building the cart:

```sh
cargo run -p calyx-cli -- run \
  --cart carts/seaway-dig/cart.wasm \
  --frames 566 \
  --in conformance/carts/seaway-dig/seaway-dig.in.json \
  --out build/seaway-visual/frame-0565
```

Native and web must reproduce the same blessed framebuffer/event stream, but
the blessing itself does not substitute for this legibility review.

## Provenance and current limits

The behavioral ancestry is the implemented Godot `seaway_dig` cart. This
README is the current cart contract.

Preserved behavior includes the shipped map ratios, material timing, manual
digging, worker claims/states, dirty flood fill, room camera, minimap,
scrollable overview, zone/milestone/completion phases, bottleneck rule, barge
flow, debug mode, help, music, fanfares, and post-completion exploration.

Intentionally changed for Calyx:

- fixed seeded terrain replaces host RNG;
- integer/fixed-point motion replaces delta-time floats;
- ordered dithering and palette steps replace alpha;
- the title receives a small canal vignette and terrain receives restrained
  chips/glints;
- text layout uses the ABI-pinned proportional `m6x11` metrics;
- completion uses one dedicated overlay instead of stacking identical
  milestone and completion messages.

The current cart does not include flags, excavators, passive off-screen labor,
resources or income, boulders, towns, harbors, infrastructure growth, the
northern canal, sensitive sites, political heat, timeline eras, Sarba,
persistence, upgrades, or a platform-wide tween or UI framework.
