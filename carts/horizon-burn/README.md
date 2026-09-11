# Horizon Burn

> **Status:** Playable Calyx prototype
> **Genre:** Globular combat racer · **Category:** Games
> **Author:** Cheesy Crab · **Version / ABI:** Cart 0.6.0 · Calyx ABI v1
> **Release posture:** Opted into the current curated release catalog

## Concept and player promise

Horizon Burn is a forward combat run over the visible cap of a small world:
ride the curvature at reckless speed, carve a line through incoming formations,
and vacuum their luminous dust into an escalating weapon stack. The planet is
the track. Curved racing contours rush from the crest toward the ship while
threats grow over the horizon and cut across the player's route.

The cart combines Wipeout-like speed and line choice with Super Stardust-like
pressure and power growth. It remains a deterministic surface rail-shooter,
not free flight or a general 3D engine.

## Controls

| Input | Action |
|---|---|
| D-pad / digital stick mapping | Carve continuously across the broad visible cap |
| A (held) | Autofire the current weapon stack |
| B (held) | Deep focus: one-third world time, precision steering, visible hit core, weapon locked |
| Left / Right on title | Choose threat density |
| A / Start | Launch or retry the current difficulty |
| B on result | Return to difficulty selection |

Unfocused response begins on the first held frame. The ship can cross almost
the full screen and move through roughly 68 vertical pixels without touching
the HUD. Focus advances enemies, hostile fire, dust, and terrain on only one
of every three simulation ticks while preserving precise player steering. It
cannot be combined with fire: focus is a committed defensive state for
threading dense formations, not a damage buff.

## Difficulty

All modes use identical player handling, world speed, threat speed, hitboxes,
dust thresholds, and three-point hull. Difficulty changes deterministic
formation membership and hostile fire density, preserving muscle memory.

| Mode | Formation density | Typical pressure | Score multiplier |
|---|---|---|---:|
| CRUISE | Two core members | Fast 56-frame cadence; some drones withhold fire | ×1.0 |
| BURN | Core, support, flank, two hunters | Dense five-member waves with center pressure | ×1.5 |
| REDLINE | BURN formation plus escorts | Seven-member waves; late drones pulse three times | ×2.0 |

The title defaults to BURN and remembers the selection for the session.

## Dust and weapon progression

Every destroyed enemy emits three to five bright dust motes. They automatically
curve across the projected surface and are vacuumed into the ship; the player
never has to chase or manually collect a pickup. Accumulated dust permanently
unlocks the run's linear weapon stack:

| Dust | Upgrade | Effect |
|---:|---|---|
| 15 / 113 / 330 | SPLIT I / II / V-SHOT | Two parallel bolts, then three; V-SHOT becomes one center bolt plus two outward pea shots |
| 36 / 165 / 450 | RAPID I / II / III | Autofire cooldown falls from six to three frames |
| 60 / 225 / 540 | PIERCE I / II / III | Bolts survive one, two, then three enemy hits |

Upgrades stack, never decay on damage, and announce themselves both in the HUD
and with a short `ONLINE` banner. Tier I spans the opening, tier II is
distributed through the middle, and V-SHOT arrives in the late gauntlet. Each
confirmed boss hit sheds two additional dust motes, bringing RAPID III and
PIERCE III online during the Warden fight rather than before it. The lower rail
shows dust, the S/R/P ladder, and sortie progress.

## Sortie and threat language

The wave schedule advances on world frames; focus extends its real-time
duration, and the final boss continues until defeated. Formations arrive every 56
world frames across six named phases: rock run, drone wing, sweeper cross,
converging hunters, armed storm, and final gauntlet. Tracking and repeat fire
rise with the phases. BURN always includes a center-biased hunter so the safe
line cannot collapse into simply holding the middle.

Every enemy is hittable from the first frame it is visible, including its
yellow horizon silhouette. A confirmed hit produces a white impact bloom,
colored breakup sparks, an explosion tone, and immediate dust release. There
is no hidden approach-state armor or delayed damage threshold.

At the end of the final gauntlet, the Warden rises over the horizon for a short
boss battle. Its left wing, right wing, and core have independent integrity;
the HUD exposes their combined segmented health. Each projectile visibly
flashes the hull, destroyed wings remain as broken stubs, and losing a wing
accelerates its lateral sweep and aimed pulse cadence. The sortie ends only
when the Warden is destroyed. V-SHOT trades the former five-bolt point-blank
damage spike for broader outward coverage, keeping the finale from collapsing
under one concentrated volley.

The killing hit locks controls and weapons into a three-second victory outro.
Secondary wing and core detonations shake apart the Warden, an expanding blast
flashes the framebuffer, the ship coasts beneath the debris, and a black result
panel grows into place before normal retry/difficulty input resumes.

The launcher cover is a compact version of that promise: a white-red racer burning around a cyan planetary rim into an enemy formation. The painted source is `concepts/launcher-cover-source.png`; the tracked 64×64 indexed preview is `icon-64.png`. Rebuild it and `icon.bin` from the repository root with:

```sh
python3 tools/build_launcher_icon.py \
  carts/horizon-burn/concepts/launcher-cover-source.png \
  --preview carts/horizon-burn/icon-64.png \
  --binary carts/horizon-burn/icon.bin
```

| Threat | Shape / color | Behavior |
|---|---|---|
| Rock | Warm irregular body | Passive surface hazard and dust source |
| Drone | Red downward gull | Curved entry and preflashed aimed pulses |
| Sweeper | Purple lateral diamond | Crosses the route and forces line changes |

Threats begin as typed yellow horizon tells. They can be shot immediately,
but contact with the ship only applies after they enter the active field. They
remain one-hit targets; difficulty comes from formation geometry and density,
not bullet-sponge health. Losing three hull points leads to `SHIP LOST`;
destroying the Warden and finishing the outro reaches `HORIZON SECURE`.

## Projection and deterministic model

Entities live in bounded cart-local spherical coordinates. A heavily cropped
orthographic near-hemisphere (`R=200`) maps them to integer framebuffer
coordinates. Nine moving transverse racing contours, converging meridians,
steering-driven pursuit yaw, and accelerating terrain flecks make
the surface itself carry the speed fantasy. The ship banks and lengthens its
exhaust under lateral input.

Finite-domain guest-side `f64` supplies sine/cosine and bounded integration.
Drawing quantizes to integers, collision stays in surface coordinates, and
entity caps hold REDLINE to twenty-four threats, twenty-four hostile shots, and forty-eight
visible dust motes. No host math imports, ABI additions, or shared 3D/entity
systems are introduced.

## Build and verification

From the Calyx repository root:

```sh
npm --prefix carts/horizon-burn ci
npm --prefix carts/horizon-burn run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
python3 tools/catalog.py dist-web --profile sideb
node web/product-smoke.mjs --profile sideb
```

The conformance feed selects and launches BURN; reaches the expanded movement
envelope; measures one-third-time, fire-disabled focus; hits an enemy while it
is still on the visible horizon; unlocks all nine weapon tiers through homing
dust from both formations and boss armor; witnesses piercing fire; takes
survivable damage; breaks both Warden wings and its core; verifies the locked
explosion outro and eased result reveal; returns to difficulty selection; and
relaunches REDLINE.
Native and web runtimes must reproduce one blessed
framebuffer/audio/trace stream.

## Provenance

The launcher painting was generated for this cart and is distributed under the cart's declared license. Its source, indexed preview, and runtime bytes remain together in the cart directory. World projection, ship, threats, projectiles, dust, boss, HUD, effects, and tones are authored in `cart.ts` from indexed geometry and audio intent; the cart loads no external runtime content.

## Prototype scope

Version 0.6 includes one ship, one finite sortie, three density modes, three
primitive threat roles, three-hit survival, automatic dust collection, three
continuing three-tier weapon branches, six attack phases, score multipliers,
one-third-time focus, a three-part boss, a staged victory outro, simple tones,
and indexed geometry.

Explicitly deferred: additional bosses, racing opponents, laps, branching weapon choices,
ammo, manually collected pickups, authored sprites or
textures, terrain maps, persistence, leaderboards, procedural campaigns, free
flight, arbitrary cameras, shared spherical math or entity systems,
generalized 3D rendering, and ABI additions.
