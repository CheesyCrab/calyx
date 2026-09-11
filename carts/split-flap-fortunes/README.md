# Split-Flap Fortunes

> **Status:** Implemented and opted into the current curated release catalog
> **Category:** Demos · **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.1.0 · Calyx ABI v1

## Experience

Roy, a cow in a transit-operator hat, tends a mildly demented departure board.
Each requested route is an optimistic four-part fortune: what the traveler is
leaving, where they are bound, how they might get there, and the service status.
Roy offers one short piece of practical commentary when the board settles.

The cart contains 24 fully authored itineraries rather than freely recombining
fragments. That keeps each result coherent while the physical transition between
messages supplies fleeting false starts and accidental near-fortunes.

## Controls and timing

- A, Right, or Down dispenses another shuffled route.
- Left or Up revisits the previously dispensed route.
- B opens Roy's interpretation after the board settles; B closes it again.

Each character step takes three frames. Every flap advances through the fixed
character wheel until it reaches its target, and the cart emits one coalesced
clack per active step. Routes do not advance automatically: a settled message
waits to be read.

The first request seeds a cart-local shuffle bag from its input frame. The
timing makes the order vary between sessions while remaining deterministic and
exactly replayable. The opening route is excluded from the first bag, all other
23 routes appear once before refill, and refills prevent an immediate repeat.

## Presentation and implementation

Four fixed label plaques leave fourteen flap cells for every value; all authored
values are capped at that physical width and never truncate. Values use the
ABI-pinned font at 2x scale. The shortened left plaques also use 2x type and
remain inside their frames. Wide cell gutters, shaded upper leaves, side hinge
blocks, and a single center seam give the board its clattery mechanical feel.
The board also has a framed cabinet,
inset trim, fasteners, status lamp, and a distinct amber moving state.

Roy keeps his advice behind B: open his portrait panel for a 2x four-line
interpretation and the route status. Route input pauses while he is speaking;
close the panel to return to the board. Everything
is drawn from indexed primitives and compiled into the Wasm. There is no file
loading, host clock, host randomness, persistence, or external content.

## Verification and provenance

From the Calyx repository root:

```sh
npm --prefix carts/split-flap-fortunes ci
npm --prefix carts/split-flap-fortunes run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
```

The canonical feed covers a settled opening route, Roy modal open/close,
forward and backward route requests, intermediate flap states, completed
messages, and clack events. This is the accepted Calyx replacement for Godot's
`split_flap`; fixed-frame timing and Wasm-embedded content are intentional
platform adaptations.

Out of scope: clocks or daily fortunes, user-authored messages, network feeds,
persistence, variable board sizes, proportional typography, and a reusable
flap-display framework.
