# Calyx Resonator

> **Status:** Implemented HD example in the Dev and Side B catalogs
> **Category:** Demos · **Author:** Cheesy Crab
> **Version / ABI:** Cart 0.2.0 · Calyx ABI v1.6
> **Release posture:** Maintained public-source example outside the release catalog

Calyx Resonator is a 45-second, no-fail arcade instrument for the fixed
1280x720 Calyx HD display and extended digital controls. A luminous square orb
crosses a four-petal mechanism. Timed button presses redirect it, wake the
petals, build a combo, and add color and sparks to the field. Missing a beat
breaks the combo but never ends the run. The result appears after 45 seconds,
then the instrument resets itself.

The visual language is deliberately complete without illustrated assets:
stepped diamonds, square light, flat indexed color, sparse stars, and hard
mechanical borders. It is not a placeholder layout awaiting an art pass.

## Controls

- D-pad nudges the orb.
- X, A, B, and Y strike the matching top, right, bottom, and left petals,
  following the TG5050's printed face-button diamond.
- L and R fire the side vanes.
- Start toggles a compact live-input panel.

Keyboard controls are arrows, Z/X for A/B, A/S for X/Y, Q/W for L/R, and Enter
for Start. Standard controllers use the D-pad, four face buttons, shoulders,
and Start. There is no analog or trigger input.

## Runtime behavior

Simulation, input, and audio run at 60 Hz. The manifest requests 30 Hz
presentation, and Sunny's `run_update_30` lifecycle redraws even-numbered cart
frames only. Motion, particles, scoring, tones, the 45-second round, and reset
are deterministic. The cart uses only ordinary Calyx ABI imports and a
cart-owned 16-color palette.

From the Calyx root, build and verify it with:

```sh
npm --prefix carts/examples/hd-input-lab ci
python3 tools/dev.py cart hd-input-lab
python3 conformance/check.py verify
```

To run it with its HD display, extended controls, and 30 Hz presentation
metadata, open the developer console:

```sh
python3 tools/catalog.py play-window --profile dev
```

Select **Demos**, then **Calyx Resonator**. The console reads the cart manifest;
a raw `calyx run` does not select extended presenter controls from that manifest.

This is a compact game-shaped performance and input witness, not a release
catalog game. It has one arena, one timed mode, no persistence, no sampled
audio, and no external assets. All geometry, text, palette values, effects, and
tones are authored in `cart.ts`; there is no third-party art or audio.
