# Calyx Launcher

> **Status:** Implemented privileged system cart
> **Category:** Settings / console UI · **Author:** Cheesy Crab
> **Version / ABI:** Cart 1.0.0 · Calyx ABI v1.6 system surface
> **Release posture:** Always included as the release catalog entry point

## Product role

The Launcher is Calyx's home screen: pick a shelf, browse its carts, and
press A to jump in. It reads cart name, author, version, category, and
64×64 icon through privileged `calyx.sys`, groups carts by category, launches
the selected cart, and is the home target when a presenter-level Back action
exits ordinary play.

The preferred category order is Games, Stories, Challenges, Demos, Settings, then additional categories in stable lexical order. Empty categories are hidden. Cart metadata and three indexed icon sizes are loaded into dynamically sized cart-local arrays from the host-reported catalog count. The horizontal dot rail below the selected cart mirrors the top-level category rail; its filled dot is the active category. Vertical dots beside the icons report cart position within that category.

## Interaction

- Left/Right changes category.
- Up/Down changes the selected cart within the active category.
- A launches the active cart.
- Start opens help; Start or B closes it.
- The last selected row in each category is remembered for the current
  in-memory launcher session.
- Category changes establish that remembered row immediately while the
  category rail continues its horizontal glide. Vertical easing is reserved
  for movement within one category, so a new stack cannot fall through the
  category labels.
- Horizontal navigation wins over vertical navigation on a diagonal input
  frame, preventing an accidental row change in the destination category.

After the first meaningful input, the footer adapts to keyboard or controller
through the ABI input-method report. It uses readable semantic
actions and generic controls, not compact internal abbreviations or
brand-specific controller art. Before any input—and for touch, where the
controls are already visible on screen—the launcher draws no redundant bottom
control panel. The home screen does not advertise Back because it has nowhere
further back to go.

## Presentation and deterministic state

The launcher uses a seeded starfield, one broad dithered monochrome wave sheet,
a horizontal category rail, and a depth-staged vertical cart column. The
selected 64×64 source icon is presented at a pixel-crisp 64px, immediate
neighbors at a solid palette-darkened 32px, and second neighbors as darker
16px edge hints instead of vanishing
behind an invisible clip. A horizontal dot rail reports the active category
using the same filled/outline language as the vertical in-category dots. A
left-aligned Calyx mark/wordmark lockup, selected-cart title,
Cheesy Crab credit, motion bumps, selection/launch tones, and concise help
complete the surface. Icons float directly in the field without backing
rectangles, and selected titles are unboxed type. Author metadata remains in
the catalog record but is deliberately omitted from the chooser. Long ABI-valid labels are
fitted with an ellipsis, and large category sets use a centered sliding dot window. The
launcher consumes the host-reported catalog count without an independent cart
ceiling. Category and row cameras use integer subpixel state;
installed metadata and input method are explicit deterministic system inputs.

It does not read files, wall time, presenter dimensions, or network state from
inside the cart. Catalog discovery and shell-level home/quit behavior belong
to the host; visible launcher behavior belongs here.

## Build and verification

From the Calyx repository root:

```sh
npm --prefix carts/system/launcher ci
npm --prefix carts/system/launcher run build
cargo run -p calyx-cli -- verify
node web/conform.mjs
python3 tools/catalog.py smoke
```

The conformance fixture supplies multi-row categories and scripted input-method
changes, then pins the three-depth cart stack, category navigation, remembered
rows, adaptive footer/help, metadata decode, audio, and launch intent across
native and web. Catalog smoke boots the real launcher, launches Settings, and
returns home.

## Scope

The Launcher is a system cart only because it needs installed-cart metadata and
launch control. It does not own catalog assembly, release opt-in, persistence,
downloads, installation, updates, accounts, storefront behavior, box art,
search, favorites, or arbitrary host UI. This README is authoritative for the
launcher cart itself.
