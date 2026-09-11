# Wormtide

> **Status:** Implemented and opted into the current curated release catalog
> **Category:** Games · **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.0.0 · Calyx ABI v1

## Player promise

Command sixty luminous worms through near-total darkness against sixty hidden
rivals. Your swarm flows toward a movable attractor. Echolocation reveals the
enemy only where an expanding wavefront or close-range vision reaches it.
Contact destroys one worm from each side, so formation density and incomplete
information decide the fight.

## Play loop and controls

1. Press A or Start on the title screen to seed both 60-worm swarms.
2. Move the attractor with the D-pad; the player swarm seeks it while
   separating from nearby allies.
3. Press A when charged to emit sonar from the player centroid.
4. Read bright wavefront reveals and fading afterglow while both swarms move.
5. Survive mutual-annihilation contacts until one population reaches zero.
6. Read outcome statistics, then press A or Start to return to title.

The enemy attractor retargets every three seconds. Sonar has a 160 px maximum
radius, 12 px reveal band, and cooldown. Local 15 px vision can expose nearby
enemies without a ping. The result screen reports survivors, casualties,
elapsed time, and pings fired.

## Visual and audio language

Wormtide uses the four-color GAMEBOY palette: darkness is terrain, player
worms and sonar are light, fresh reveals and the cursor are bright, and decay
falls through intermediate shades. Tails, a small attractor trail, expanding
ping rings, reveal afterglow, collision sparks, population HUD, and recharge
ritual make simulation state readable without turning fog into decoration.
Audio is coalesced around sonar, reveal, combat, charge, and outcomes so 120
entities cannot flood the event stream.

## Deterministic simulation

Persistent position and velocity use cart-local Q8. A bounded guest-side
`f64` island calculates guarded normalization, seek, separation, and speed
limiting, then immediately quantizes back to Q8. Sonar, vision, aggro,
collision, death, state changes, traces, and drawing all consume quantized
state and squared distances. Timers are integer frames and allocation is
bounded.

The intentionally readable O(n²) same-swarm separation and combat passes are
part of the cart's platform-pressure role. No host math imports, nondeterministic
RNG, verifier mutation, density grid, or adaptive population is used.

## Verification

From the Calyx repository root:

```sh
npm --prefix carts/wormtide ci
npm --prefix carts/wormtide run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
```

The canonical feed moves the attractor, fires sonar, attempts input during
cooldown, observes reveal/decay and proximity vision, sustains combat, and
reaches a natural outcome without test-only state mutation.

## Provenance and scope

This is a deterministic Sunny swarm game. This README is its complete current
contract.

The swarm rules and all indexed drawing, text, and audio intent are authored in `cart.ts`; the cart loads no external art, audio, data, or third-party content.

Preserved: two 60-worm swarms, cursor seeking, same-swarm separation,
three-second AI retargeting, centroid sonar, afterglow, local vision,
mutual-annihilation combat, tails, sparks, cooldown, counts, and title/play/
win/lose flow. Calyx changes exact trajectories through Q8/f64 quantization
and adds bounded HUD/audio/title polish.

Out of scope: unit types, terrain, split groups, economy, upgrades, density
buffers, spatial hashing, adaptive populations, networking, persistence, and
the old 1,000–10,000-worm benchmark direction.
