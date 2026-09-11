# Calyx Architecture

## Product boundary

Calyx is a small fantasy console for portable WebAssembly carts. It provides a
fixed-step simulation, an indexed or opt-in true-color framebuffer, a seven-button Classic input
face with an additive four-button extended digital profile,
tone-event output, system carts, and multiple presenters. It does not provide a
scene editor, retained scene graph, entity-component system, physics engine,
or plugin runtime.

The portable product artifact is the cart `.wasm` file. A v1 cart does not need
files, network access, platform APIs, or a particular presenter after it is
built.

## Guest carts and Sunny

Carts are AssemblyScript guest modules. Sunny (`@cheesycrab/sunny`) supplies
the ordinary authoring interface, lifecycle wrapper, input edges, geometry,
text metrics, palettes, deterministic random numbers, music sequencing, and
numeric helpers. Sunny compiles into each cart, so its guest-side behavior is
identical in every runtime.

An ordinary cart exports `start()`, `update()`, and linear `memory`. Console
functions come from the `calyx` module; AssemblyScript may also import
`env.abort` to report failed assertions. Privileged system carts may import `calyx.sys`; the
host rejects that module for ordinary carts at link time.

## ABI boundary

[ABI v1.6](ABI.md) is the only contract shared by a cart and a runtime. It
defines imports, exports, memory checks, drawing and input semantics, the fixed
60 Hz simulation step, system-cart records, headless formats, and hashes.

The guest and host share the ABI specification. They do not share runtime
implementation code. An observable ABI change must be versioned and reproduced
by every runtime with conformance evidence.

## Peer native and web runtimes

The Rust runtime in `crates/` and the JavaScript runtime in `web/` are peers.
Both instantiate the same cart artifact and implement the ABI independently.
The conformance suite supplies common carts, input feeds, expected hashes,
event streams, and expected faults.

The native command-line interface provides headless, terminal, window, and SDL
presenters. The web runtime provides the browser canvas, controller input,
touch controls, audio presentation, and installable progressive web app shell.

The hosted player can also admit one explicitly selected local cart. This is a
presenter security profile, not an ABI dialect. The player validates exact
ordinary imports, lifecycle signatures, declared memory and table bounds, and
resource ceilings, then runs the guest in a disposable worker with main-thread
watchdogs. Bundled carts retain the normal trusted execution path. Selected
bytes remain local and never become catalog or persistent player state.

## Verified state and presenter output

Verified state consists of the framebuffer, palette identity, input
echo, frame-stamped audio and system intent, traces, and faults. Each run folds
per-frame framebuffer hashes into one deterministic `run_hash`.

Presenters consume this state. A screen, terminal, speaker, keyboard,
controller, or touch deck must not redefine simulation or cart-visible
semantics. Audio samples and display timing are presenter output; audio intent
and the 60 Hz simulation timeline remain verified.

Native and web hosts share one internal cart-update path between verified and
live stepping. Verified stepping hashes the framebuffer and records
the input echo for conformance. Interactive stepping returns the same audio,
system intent, traces, faults, pixels, and frame progression without computing
an otherwise unused full-frame hash.

## Placement rule

Every host import is permanent cross-runtime parity surface. Put functionality
in Sunny when it can lower cheaply to existing imports. Put it in the host only
when it needs host-owned data, per-pixel-scale access, or another capability
that guest code cannot provide efficiently.

For example, the host owns the framebuffer and font bitmaps. Sunny owns line
and circle drawing, text measurement, input edge detection, music sequencing,
and deterministic random-number helpers.

## Intentional limits

ABI v1 has no wall clock, host random-number generator, persistence, network,
runtime AI service, raw framebuffer mapping,
mid-run palette changes, rotated blits, registered callbacks, or general device
discovery for ordinary carts. Indexed and RGBA source images support
nearest-neighbor scaling, source regions and clipping. True-color output uses
integer source-over compositing; other blend modes and filtered scaling are
unsupported. PNG conversion happens at build time, preserving the single-Wasm
cart and keeping file access outside the runtime.

These limits keep cart replay deterministic and the parity surface small. An
unsupported capability remains outside the contract until its exact observable
behavior is deliberately specified and verified.
