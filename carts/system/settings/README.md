# Calyx Settings

> **Status:** Implemented privileged system cart; Dev and Side B only
> **Category:** Settings · **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.0.0 · Calyx ABI v1.6 system surface

## Product role

Settings is a small deterministic companion to the Launcher for development,
Side B experiments, and system-cart conformance. Calyx 1.0 does not include it
in the release player because the console has no persistent settings contract.
It is deliberately presented as a **Preferences Preview**, not as a production
configuration surface. Compact controls sit beside a live signal chamber where
every preference has an immediate visible or audible demonstration. Values live
only for this cart invocation and reset when it is reloaded.

## Rows and controls

| Row | Behavior |
|---|---|
| Volume | Controls the local navigation-preview tick from 0–10 |
| Scanlines | Applies a visible scanline preview to the Settings content |
| Tick Sound | Enables or disables the local navigation-preview tick |
| About Calyx | Opens product/ABI/credit readout |

Up/Down selects a row. Left/Right adjusts the selected value or opens About
on its row. A also opens About
when that row is selected; A or B closes About. Start calls privileged
`sys_exit` and returns to the launcher from either surface.

The screen labels these controls `LOCAL ONLY - RESETS ON HOME`; they are
local demonstrations; they do not change presenter state. The live chamber has an animated orbit/sweep, a volume-driven
meter, a pulse on tick activity, and scanlines confined to the preview glass.
Prompts adapt to the last meaningful keyboard, controller, or touch input
method. The About surface displays the Calyx mark, Calyx product version, ABI
version, Sunny relationship, and “A Cheesy Crab project” credit.

## Contract and verification

The visible controls mutate their preview immediately but do not mutate
presenter volume, shaders, or launcher state. Real console-wide effects remain
out of scope until a host settings contract exists.

From the Calyx repository root:

```sh
npm --prefix carts/system/settings ci
npm --prefix carts/system/settings run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
python3 tools/catalog.py smoke
```

The system-cart golden covers row navigation, adjustments, adaptive prompts,
About open/close, product identity, and exit intent. Catalog smoke verifies the
launcher→Settings→launcher chainload.

All visible controls, the signal chamber, the Calyx mark rendering, and audio intent are authored in `cart.ts`. State advances from integer frames and explicit input only; the cart loads no external art, audio, or data.

Out of scope: persistence, host configuration writes, real mixer control,
shader configuration, key rebinding, language, accessibility suites,
network/account settings, and any claim that transient values survive a cart
swap.
