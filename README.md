# Cheesy Crab Calyx

<img src="assets/brand/calyx-mark.svg" alt="Calyx mark" width="96">

**Calyx is a tiny game console you can understand, test, and carry around.** Open the player, try a few carts, then change one AssemblyScript file and make the machine do something that was not there five minutes ago.

[**Downloads**](https://github.com/CheesyCrab/calyx/releases) · [**Run from source**](#run-from-source) · [**Make your first cart**](#make-your-first-cart)

> **Release status:** Calyx 1.0.0-rc.1 is a release candidate implementing
> ABI v1.6, with Classic as the default and an opt-in Calyx HD profile.
> The release catalog remains Classic; HD carts are available in the developer
> and Side B catalogs. Expect some rough edges; stable 1.0 comes later.

## Try the examples. Then make one.

The included carts are games, simulations, tactile experiments, and one unusually playable SDK manual. They are also working examples you can take apart. Their complete source lives in [`carts/`](carts/), so you can follow a button press all the way to a verified frame and then meddle with it.

The curated player catalog has seven carts:

| Cart | Come here for… |
|---|---|
| [Horizon Burn](carts/horizon-burn/README.md) | A fast combat run across a tiny curved world |
| [Micro AI War](carts/micro-ai-war/README.md) | Build an army, give it a doctrine, then see what happens |
| [Seaway Dig](carts/seaway-dig/README.md) | Dig a canal, grow your crew, get the barges moving |
| [Wormtide](carts/wormtide/README.md) | Lead a swarm through darkness with sonar |
| [Split-Flap Fortunes](carts/split-flap-fortunes/README.md) | Travel advice from Roy the cow and a mildly demented departure board |
| [Sunny API Lab](carts/sunny-api-lab/README.md) | A playable tour of the SDK |
| [hello-sunny](carts/examples/hello-sunny/README.md) | A tiny cart to take apart and make your own |

The source tree also includes HD examples and system carts. They are not all
part of that player menu; `release = true` in a cart's manifest selects the
curated lineup.

Calyx stays small on purpose, and that buys it a few lovely properties:

- **You can finish things.** The default 320×240 indexed screen, compact controls, and Sunny SDK keep a small game from disappearing into six months of engine assembly.
- **You can see what happened.** Deterministic input replays, framebuffer hashes, traces, frame dumps, and screenshots let a person or coding agent inspect a cart without puppeteering a graphical editor.
- **You can take it with you.** One `.wasm` cart runs unchanged in the native and web runtimes already exercised across the phone PWA, Linux handheld, desktop, terminal, and headless CI.

For 1.0, sharing a cart is pleasantly literal: hand someone the Wasm file and they can open it locally in a packaged player or the web player. Grand distribution machinery can wait outside.

## Make your first cart

The player has an **Upload** action and a small Node-only starter. Download the `calyx-cart-starter-1.0.0-rc.1.zip` asset from [the release page](https://github.com/CheesyCrab/calyx/releases), extract it, and open the extracted directory. You can also assemble it from source with `python3 tools/starter_package.py`; this bundles [`starter/`](starter/) with its pinned Sunny source. Then run:

```sh
npm install
npm run build
```

Edit the marked values in `cart.ts`, rebuild, return Home, and choose the resulting `cart.wasm` with **Upload**. The file stays on your device and disappears from the player when you leave it.

Building a cart from the extracted starter needs only Node.js 20 or newer and npm 10 or newer. Use the browser player described below to try the result. The maintained starter source is in [`starter/`](starter/), and [Cart Authoring](docs/CART_AUTHORING.md) has the complete procedure.

Repository contributors can instead generate a catalog cart from the [`hello-sunny` example](carts/examples/hello-sunny/README.md). The [Sunny API reference](sdk/README.md) and [Sunny API Lab](carts/sunny-api-lab/README.md) cover the supported authoring surface.

## Run from source

Install Rust 1.95 or newer and Cargo, Node.js 20 or newer, npm 10 or newer, and Python 3.11 or
newer. Run commands
from the Calyx root (the directory containing this README). See the
[CLI prerequisites](crates/cli/README.md#build-prerequisites) for native build
tools and platform libraries.

On macOS or Linux, start the native window player:

```sh
./play-window.sh
```

On Windows, run:

```bat
play-window.bat
```

Start the local browser player with `./serve-pwa.sh --profile release` or
`serve-pwa.bat --profile release` and open the URL it prints. The browser player can be installed as a progressive web app when the browser accepts the serving origin. Calyx also provides SDL, terminal, and headless entry points; see [Running Calyx](docs/RUNNING.md).

## Controls

| Action | Keyboard | Controller |
|---|---|---|
| Move/select | Arrows or WASD | D-pad (SDL also accepts left stick) |
| A | Z | South face button |
| B | X | East face button |
| Context/help | Enter | Start |
| Return to launcher | Backspace | Back/View |
| Quit | Escape | Guide/Home |
| Toggle SDL performance panel | Q+W, then A | L+R, then X |
| Toggle SDL performance log (panel visible) | Q+W, then S | L+R, then Y |

Controller mappings apply to SDL and the browser; the basic native window uses
the keyboard. The web player also supplies a touch controller on mobile layouts.
See [Running Calyx](docs/RUNNING.md#controls) for extended-input controls.

## Why this tiny thing exists

Calyx grew out of wanting to make games when most available computing time meant a phone, an SSH connection, and whatever minutes a young child had not already claimed. An earlier Godot cartridge API found the basic shape. Things really started moving when deterministic verification let a coding agent see, replay, and revise its own cart. The iOS PWA and Linux handheld presenters came from the same stubborn wish: the game should work wherever its author happens to have escaped to.

There is no AI service lurking inside the console. The interesting agent story happened in the workshop: Gemini 2.5 Flash produced one of the most complete single-pass cart prototypes because the API was small, the rules were clear, and the result could be observed. That cart is not in the release catalog; the useful bit is that the same boundedness helps humans and modest machines get from an idea to a working game. [AI Use](docs/AI_USE.md) has the straight disclosure.

## Coming when it comes

This is the bit where I plant a few flags and very carefully decline to attach dates. Development continues while the public release waits; real carts and real hardware still get the final vote.

- **More carts using the expanded API.** HD already provides 1280×720, with extended digital controls available independently. Both resolutions support indexed or full-color drawing, alpha blending, scaled sprites, clipping, and tint. The [Sunny API Lab HD](carts/sunny-api-lab-hd/README.md) demonstrates the drawing tools; actual games should guide what comes next.
- **Portable play.** Record deterministic input, tuck it into a replay with enough identity to reproduce the run, send it to a friend, and let another runtime prove that the same thing happened. Portable save state might join the party later if it can behave itself across runtimes.
- **More weird little computers.** Linux AArch64 and thin hardware adapters are invited as soon as there is suitable hardware on the desk to test them properly.

Analog input, networking, faster simulation, and cart packs are scribbled elsewhere on the napkin. They can wait their turn. Small enough to finish remains the trick.

## How the trick works

- A cart is guest code compiled with Sunny into one portable `.wasm` artifact.
- The native Rust runtime and web JavaScript runtime independently implement the same ABI.
- Simulation advances at exactly 60 ticks per second. A cart can observe only its frame number, input, and its own state.
- The framebuffer bytes and per-frame event stream are verified. Windows, terminals, speakers, and browser canvases are presenter output.
- Drawing helpers and other deterministic features stay in Sunny unless they require host-owned data or measured per-pixel host work.

The default console profile is a 320×240 indexed framebuffer with the SWEETIE-16 palette. See [Calyx Architecture](docs/ARCHITECTURE.md) for the implementation boundaries and [the ABI](docs/ABI.md) for the normative cart contract.

**Cheesy Crab Calyx** is the formal product name. **Calyx** is the ordinary shorthand, and **CAL/X** is its in-world display mark.

## Repository map

```text
assets/         shared fonts and product marks
carts/          maintained first-party, system, and example carts
conformance/    native/web compatibility fixtures and goldens
crates/         native Rust runtime and command-line player
docs/           player, author, architecture, and policy documents
packaging/      supported package definitions
sdk/            Sunny AssemblyScript SDK
starter/        source for the downloadable first-cart ZIP
tools/          cart, catalog, asset, and verification utilities
web/            peer JavaScript runtime and browser player
```

## Project information

- [Documentation index](docs/README.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Versioning](docs/VERSIONING.md)

Calyx uses component licenses. The native and web runtimes and players are `LGPL-3.0-or-later`; Sunny is `MIT OR Apache-2.0`; first-party carts normally use `GPL-3.0-or-later` as whole works. Independent cart authors choose their own licenses. See [Calyx licensing](LICENSE.md) for the exact boundaries.
