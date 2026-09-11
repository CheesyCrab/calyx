# Micro AI War

> **Status:** Playable doctrine-building auto-battler in the current curated release catalog
> **Category:** Games · **Author:** Cheesy Crab
> **Version / ABI:** Cart 0.1.0 · Calyx ABI v1

## Purpose

Build a small army, assemble one shared battlefield doctrine, and watch Foot, Bow, and Rider units interpret those orders according to their roles. The default muster puts forty agents on each side. Changing one doctrine piece can alter how the player's army gathers, screens allies, concentrates damage, or withdraws while the CPU repeats the same Guard plan and deterministic seed.

Micro AI War is an observation game as much as an auto-battler. The doctrine editor uses connected command pieces and plain battlefield language instead of code syntax. Colored unit pennants and the debrief show which priority group actually directed each unit.

## Play loop

1. Press A or Start on the title screen.
2. Spend up to 62 supply on Foot, Bow, and Rider units.
3. Start from Balanced, Guard, or Hunter, then replace or remove condition and order pieces in the three priority groups. A default order is always present.
4. Deploy. A short march-in and countdown precede the autonomous battle; A or Start skips that presentation.
5. Pause when needed to inspect the field. Normal battle time is 30 seconds; cleanup can continue to 40 seconds when either army has four or fewer units.
6. Read surviving forces and doctrine use in the debrief, then tweak the plan, rematch the identical setup and seed, or return to muster.

A battle ends early if one army is eliminated. A timed result compares surviving unit count and remaining health and may end in a draw.

## Controls

| Context | Input | Action |
|---|---|---|
| Title | A / Start | Enter muster |
| Muster | Left / Right | Select Foot, Bow, or Rider |
| Muster | A / B | Add / remove one unit |
| Muster | Start | Continue with at least one unit |
| Doctrine core | A | Load the next complete starting doctrine |
| Doctrine canvas | D-pad | Select a condition or order slot |
| Doctrine slot | A | Open the compatible-piece tray |
| Piece tray | Left / Right | Browse compatible pieces |
| Piece tray | A / B | Install / cancel |
| Optional group | B | Remove its condition and order |
| Doctrine | Start | Deploy |
| Battle intro | A / Start | Skip to autonomous battle |
| Battle | Start | Pause / resume |
| Debrief | A | Return to doctrine with the current army and plan |
| Debrief | Start | Rematch the same army, plan, and seed |
| Debrief | B | Return to muster |

## Units and doctrine

| Role | Cost | Behavior |
|---|---:|---|
| Foot | 1 | Durable screen that braces against Riders |
| Bow | 2 | Fragile ranged pressure that seeks firing space |
| Rider | 3 | Fast shock unit that punishes exposed Bow |

The available conditions are **Ally Pressed**, **Enemy Exposed**, **Outnumbered**, **Badly Hurt**, and **Far From Group**. Groups are evaluated from left to right before the required default order.

The available orders are **Advance**, **Protect Ally**, **Focus Fire**, **Regroup**, and **Fall Back**. Foot closes and interposes, Bow maintains range, and Rider commits quickly while following the same named order. A deterministic 30-frame commitment window prevents rapid branch changes from creating movement jitter.

The CPU always uses its fixed forty-unit muster and Guard doctrine. Player muster and doctrine changes therefore remain comparable across rematches.

## Presentation

The 320×240 battlefield uses a 32-color indexed palette. Foot, Bow, and Rider are equipped miniature figures with role silhouettes, facing, attack poses, impact flashes, and short-lived fallen traces. Earth, wheel ruts, grass, stones, standards, and two cloth ramps keep the field physical without hiding the units under telemetry. Health appears briefly on impact; branch-colored pennants and the debrief carry the explanation.

The title painting is stored as `art/title-painted-source.png`. It was generated with OpenAI's built-in image tool and deterministically reduced and baked into the cart. [`art/README.md`](art/README.md) preserves the prompt, provenance, and regeneration command. Gameplay figures and terrain are cart-drawn indexed primitives.

## Deterministic implementation

Persistent positions use Q8 fixed point. Target selection, squared-distance tests, role-relative order interpretation, separation, attacks, cooldowns, commitment windows, branch accounting, timing, and debrief facts use bounded integer logic. The cart uses no wall clock, host random source, host math, persistence, networking, or verifier-only state mutation. Native and web run the same Wasm against the same input stream.

## Build and verification

From the Calyx root:

```sh
npm --prefix carts/micro-ai-war ci
npm --prefix carts/micro-ai-war run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
```

The conformance journey changes the muster, edits the command tree through a compatible-piece tray, pauses and resumes a full battle, opens the debrief, returns to the doctrine, and rematches. Native and web must reproduce the same blessed framebuffer, trace, and audio stream.

When the title source changes, regenerate its checked-in reduced image and AssemblyScript module separately with:

```sh
npm --prefix carts/micro-ai-war run assets
```

## Current limits

This cart has one shared player doctrine, three roles, one open battlefield, one fixed CPU muster and doctrine, three supplied player plans, and one-match debriefing. It does not include per-role doctrines, freeform graph routing, terrain effects, deployment placement, editable formations, morale, upgrades, progression, persistence, multiplayer, generated explanations, or runtime AI.
