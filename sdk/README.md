# Sunny — the Calyx cart SDK

<img src="../assets/brand/sunny-mark.svg" alt="Sunny SDK mark" width="72">

> **New cart author?** Start with the
> [`cart authoring guide`](../docs/CART_AUTHORING.md) and the runnable
> [`hello-sunny` template](../carts/examples/hello-sunny/). Then use this
> API reference when you need more detail.

> **Prefer a runnable manual?** [`Sunny API Lab`](../carts/sunny-api-lab/)
> demonstrates the ordinary-cart surface interactively and ships with Calyx.

Sunny is the AssemblyScript toolkit for Calyx carts. It
wraps the locked [ABI v1.6](../docs/ABI.md) in a compact cart API. Its package
identifier is `@cheesycrab/sunny`. Carts in this repository use a relative
import so local builds do not require registry publication. The Sunny package
version and Calyx ABI version are separate. See
[`VERSIONING.md`](../docs/VERSIONING.md).

`@cheesycrab/sunny` is not currently published to npm. The downloadable
first-cart ZIP vendors the exact `sdk/assembly` snapshot under `sunny/`, and
its cart imports `./sunny/index`. This makes the Node-only starter
self-contained while repository carts continue to use checkout-relative
imports. CDN imports and registry publication are not currently supported.

Sunny is **guest-side** code. It compiles into the cart's `.wasm` file and uses
the ABI §4 imports. Guest-side helpers compose the existing ABI imports. The
conformance suite verifies Sunny behavior as cart code. The `sunny-math`
fixtures pin the math package directly.

Sunny uses the `MIT OR Apache-2.0` license. The author can select either
license. Sunny code compiled into a cart does not determine the cart license.

The repository exact-pins AssemblyScript for reproducible cart rebuilds.
Upgrades are deliberate maintenance: bump the pin, rebuild the catalog and
conformance suite, run native/web parity, and review golden drift. The compiler
pin is a build-input guarantee, not part of the Calyx ABI or runtime contract.

## A cart in Sunny

```ts
import {
  run_start, run_update,
  clear, px_rect, a_pressed, sfx,
  BLACK, RED,
} from "../../sdk/assembly/index"; // from carts/my-cart/cart.ts

let x: i32 = 40;

function cart_ready(): void {}

function cart_process(): void {
  if (a_pressed()) sfx("coin");
  x += 1;
}

function cart_draw(): void {
  clear(BLACK);
  px_rect(x, 100, 8, 8, RED);
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
```

The two-line shim at the bottom is the whole lifecycle contract:
`run_update` brackets the frame — input edge-arming, the music tick —
so a cart can't forget them. A cart that writes its own `update()` should
call `begin_frame()` before reading input and `end_frame()` after the frame.
If it uses the music sequencer, call `music_tick()` once per update too.

For a cart whose manifest sets `presentation = 30`, use
`run_update_30(cart_process, cart_draw)`. It keeps the complete lifecycle
bracket at 60 Hz but calls `cart_draw` only on frames 0, 2, 4, and so on,
which are the frames shown by the 30 Hz presenters. Keep gameplay state and
side effects in `cart_process`; `cart_draw` should only render current state.

## The sequencer is frame-quantized, on purpose

The sequencer uses one step per beat and `3600 / bpm` simulation ticks per step,
truncated, at the fixed 60 Hz update. Audio is verified as events: the same
frame produces the same `tone` calls, pinned by `music-box`'s
`events.golden.jsonl`. Within a step, drum rows fire before voices 0–2. Within a
frame, the cart's own `sfx` and `tone` calls precede sequencer notes because
`run_update` ticks the sequencer after `cart_process`.

## Generated modules

- `assembly/font.ts` — the m6x11 advance table, generated from the
  canonical `assets/fonts/m6x11-v1.json` by `sdk/tools/gen_font.py`
  (`--check` is the CI drift guard). Sunny embeds advances only; the
  host owns the bitmaps.
- Sprites — `tools/png2src.py` bakes a PNG into an AssemblyScript module
  (default: exact palette match, fail-fast; alpha < 128 → the index-0
  color-key hole). With `--format rgba`, it preserves RGBA bytes including
  partial transparency; no palette conversion or runtime file loading is needed.

## Math

Sunny provides scalar helpers and small value types. This code is guest-side.
It compiles into each cart and adds no host import. Import the public names from
the normal Sunny root:

```ts
import { clamp, wrap, Vec2, Vec2i, Vec3, Rect, Recti } from "../../sdk/assembly/index";
```

Repository carts use the equivalent relative path to `sdk/assembly/index`.
All angles use radians. Vectors do not know the screen size or the screen Y
direction. Apply screen or world conventions in the cart.

### Scalar functions

The generic scalar functions support `i32`, `i64`, and `f64`.

| Function | Result |
|---|---|
| `clamp<T>(value: T, low: T, high: T): T` | Limit a value to the inclusive range. |
| `saturate(value: f64): f64` | Clamp to `[0, 1]`. |
| `sign<T>(value: T): i32` | Return `-1`, `0`, or `1`. |
| `wrap<T>(value: T, min: T, max: T): T` | Wrap into the half-open range `[min, max)`. |
| `lerp(a: f64, b: f64, t: f64): f64` | Interpolate without clamping `t`. |
| `inverse_lerp(a: f64, b: f64, value: f64): f64` | Return the interpolation factor. Return `0` if `a == b`. |
| `remap(in_min: f64, in_max: f64, out_min: f64, out_max: f64, value: f64): f64` | Map between two ranges. |
| `move_toward(value: f64, target: f64, max_delta: f64): f64` | Move by no more than a nonnegative delta. |
| `wrap_angle_signed(radians: f64): f64` | Wrap to `[-PI, PI)`. |
| `wrap_angle_positive(radians: f64): f64` | Wrap to `[0, 2 * PI)`. |
| `near_equal(a: f64, b: f64, tolerance: f64 = 0.000001): bool` | Compare with an absolute tolerance. |
| `floor_i32(value: f64): i32`, `ceil_i32(value: f64): i32`, `round_i32(value: f64): i32` | Quantize with the named rule. |

Quantization is explicit. `round_i32` uses `Math.round`, so ties move toward
positive infinity.

### Value types

| Type | Components | Main operations |
|---|---|---|
| `Vec2(x: f64 = 0, y: f64 = 0)` | `x`, `y`: `f64` | arithmetic, scalar scale/divide, dot, 2D cross, length, normalize, distance, lerp, move, clamp length, equality, integer conversion |
| `Vec2i(x: i32 = 0, y: i32 = 0)` | `x`, `y`: `i32` | checked arithmetic, scalar scale/divide, dot, 2D cross, length, distance, equality, `to_vec2` |
| `Vec3(x: f64 = 0, y: f64 = 0, z: f64 = 0)` | `x`, `y`, `z`: `f64` | arithmetic, scalar scale/divide, dot, 3D cross, length, normalize, distance, lerp, move, clamp length, equality |
| `Rect(x: f64 = 0, y: f64 = 0, width: f64 = 0, height: f64 = 0)` | `position`, `size`: `Vec2` | normalized edges, center, containment, intersection, union, translation, grow, shrink, equality, integer conversion |
| `Recti(x: i32 = 0, y: i32 = 0, width: i32 = 0, height: i32 = 0)` | `position`, `size`: `Vec2i` | normalized edges, center, containment, intersection, union, translation, grow, shrink, equality, `to_rect` |

Vector value methods include `add`, `subtract`, `multiply`, `divide`, `scaled`,
`divided_by_scalar`, and `negated`. Operators cover vector `+`, vector `-`,
unary `-`, and a vector multiplied or divided by a scalar on its right.
Component multiply and divide use named methods.

Value methods return a new object. Use them for setup and ordinary gameplay.
The `*_in_place` methods compute directly into the receiver and return it. They
do not allocate a result object. Reuse operand vectors too when a hot loop must
avoid temporary allocation. `set` and `copy_from` also mutate. A zero `Vec2` or
`Vec3` normalizes to zero.

`equals` compares components exactly. `near_equals` gives `Vec2`, `Vec3`, and
`Rect` an absolute-tolerance comparison. `Vec2i` and `Recti` provide exact
`equals` only.

`Vec2i.dot`, `Vec2i.cross`, `Vec2i.length_squared`, and
`Vec2i.distance_squared_to` return widened `i64` results. Integer arithmetic
asserts instead of silently wrapping when the declared result cannot hold the
answer.

Use `floor_to_i`, `ceil_to_i`, or `round_to_i` to quantize `Vec2` and
`Rect`. Rectangle conversions quantize normalized edges and return normalized
`Recti` values.

Rectangles use half-open bounds. Left and top are included. Right and bottom
are excluded. Constructors preserve the supplied origin and extents. Relation
methods use normalized edges, while `equals` compares the stored structure.
`normalized()` returns nonnegative extents. Empty bounds keep their anchor for
containment and union. A disjoint intersection returns an empty rectangle at
the maximum left and top edges.

### Numeric assertions

All `f64` operands, checked intermediates, and results must be finite. The math
package asserts on NaN or infinity. It also asserts on invalid ranges, negative
tolerances, negative movement or magnitude limits, zero divisors, integer
overflow, and an `i32` quantization result that is out of range. `Rect` and
`Recti` growth and shrinkage assert on a negative amount. These assertions keep
invalid numeric state out of verified cart output.

## Layout

```
sdk/
├── assembly/
│   ├── index.ts      the public face (carts import this)
│   ├── abi.ts        raw ABI v1.6 externs (module "calyx")
│   ├── colors.ts     SWEETIE_16 index constants
│   ├── draw.ts       thin wrappers: clear/px_*/blit/tone/trace
│   ├── input.ts      btn decode + guest-side edge detection
│   ├── lifecycle.ts  run_start / run_update / run_update_30
│   ├── math/          scalar, vector, and rectangle math
│   ├── font.ts       GENERATED advance table
│   ├── metrics.ts    text_width / centered / wrapped
│   ├── geometry.ts   px_line / px_circle / outlines
│   ├── palettes.ts   named palettes over set_palette
│   ├── rand.ts       the blessed PRNG
│   ├── music.ts      sequencer + sfx
│   ├── screen.ts     clamp / wrap / is_on_screen
│   └── sys.ts        calyx.sys bindings — SYSTEM CARTS ONLY
└── tools/gen_font.py
```

**`sys.ts` is deliberately not re-exported from `index.ts`.** Importing
it makes the cart's `.wasm` import `calyx.sys`, which a normal cart
load refuses (ABI §4b link-time privilege) — so privilege must be
visible in a cart's own import lines. It carries `cart_count` /
`cart_info` (the pinned binary record, decoded) / `cart_icon` (4096
bytes, `blit_sprite`-ready) / `input_method` / `launch` / `exit`; the launcher and
settings conformance carts are the reference users.

## Framework boundary

Sunny may be a framework; it may not become a runtime or engine. Small,
deterministic, guest-side vocabulary belongs here when real carts otherwise
repeat or disagree on generic game-development plumbing. Retained scene/world
state, ECS or component hierarchies, physics worlds, resource lifecycles,
callback/plugin systems, editor structures, and host-backed services remain
outside the boundary.

The current surface includes scalar, vector, and rectangle math. It does not
include a fixed-point family, matrices, physics, collision suites, or retained
world state. Add another shared family only when real carts establish one
precise reusable contract.

Shared math does not require carts to replace a useful local numeric
representation. Carts retain Q8, x16, or fixed-60 integer state when its
quantization, overflow, update order, or exact output boundary is part of the
gameplay or presentation contract. Use the shared scalar and geometry
operations only where their successful-domain semantics match. Propose any
representation change as a one-cart behavior decision with intent evidence;
do not treat it as routine SDK adoption.

Authors continue to use integers by default and finite-domain guest-side `f64`
under [`FLOAT_POLICY.md`](../docs/FLOAT_POLICY.md). Sunny math adds no host math imports.

## Full color, compositing, and sprite regions

Indexed color remains the default. Call `use_true_color()` once inside the
startup callback passed to `run_start`. It selects an opaque RGBA framebuffer
at the host's current resolution and resets it to black. Calling it twice or
from an update traps. Existing palette-index drawing still works in true color.

```ts
import {
  run_start, run_update, use_true_color, clear_rgba, rgba, rgba_rect, rgba_text,
  clip_rect, reset_clip, blit_rgba_region,
} from "../../sdk/assembly/index";
import { HERO, HERO_W, HERO_H } from "./hero";

function cart_ready(): void { use_true_color(); }
function cart_draw(): void {
  clear_rgba(rgba(15, 24, 40));
  clip_rect(20, 20, 200, 140);
  rgba_rect(10, 10, 220, 160, rgba(80, 140, 220, 128));
  blit_rgba_region(HERO, HERO_W, HERO_H, 0, 0, 16, 16,
                   40, 40, 64, 64, 0, 0xffffff, 192);
  rgba_text(30, 110, "Hello", rgba(255, 255, 255));
  reset_clip();
}
function cart_process(): void {}
export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
```

For a product cart at `carts/my-cart/`, supply a PNG at least 16×16 pixels.
Generate its module from the Calyx repository root:

```sh
python3 tools/png2src.py carts/my-cart/hero.png --format rgba --name HERO -o carts/my-cart/hero.ts
```
The converter supports non-interlaced 8-bit grayscale, RGB, indexed,
grayscale-alpha and RGBA PNGs, including `tRNS`. The `.wasm` embeds the bytes.

| Helper | Behavior |
| --- | --- |
| `rgba(r,g,b,a=255)` | Pack the low byte of each channel into `0xRRGGBBAA`. Sprite arrays instead store consecutive R,G,B,A bytes. |
| `clear_rgba(color)` | Fill opaque RGB; ignores supplied alpha and clip. Requires true color. |
| `rgba_pixel(x,y,color)`, `rgba_rect(x,y,w,h,color)` | Source-over drawing in true color. |
| `rgba_text(x,y,text,color,scale=1)` | The same ABI font and integer scaling, with source-over color. |
| `clip_rect(x,y,w,h)`, `reset_clip()` | Set a persistent screen-intersected scissor or restore the whole screen. No stack; both color modes support it. |
| `blit_sprite_scaled(src,sw,sh,x,y,dw,dh,flags=0)` | Indexed sprite with nearest-neighbor destination scaling. |
| `blit_sprite_region(src,sw,sh,sx,sy,rw,rh,x,y,dw,dh,flags=0,tint=0xffffff,opacity=255)` | Crop indexed source, then scale/flip. Tint/opacity require true-color output. |
| `blit_rgba(src,sw,sh,x,y,flags=0,tint=0xffffff,opacity=255)` | RGBA sprite at 1:1. Requires true-color output. |
| `blit_rgba_region(src,sw,sh,sx,sy,rw,rh,x,y,dw,dh,flags=0,tint=0xffffff,opacity=255)` | RGBA crop with nearest-neighbor scaling and compositing. |

Region flags support `FLIP_X` and `FLIP_Y`; indexed sources additionally
support `COLOR_KEY`. RGBA sources use alpha and reject `COLOR_KEY`. Tint is
`0xRRGGBB`, not a packed RGBA color; opacity is 0–255. RGB tint and alpha
opacity multiply independently with integer rounding. Drawing uses straight
alpha and encoded RGB byte source-over, with opaque output. Source rectangles
must fit the full source image; invalid source dimensions, flags, tint,
opacity, and out-of-memory reads trap even when the destination is clipped
or empty. Nonpositive destination dimensions are a no-op after validation.

[Sunny API Lab](../carts/sunny-api-lab/) demonstrates indexed scaling, regions,
and clipping. [Sunny API Lab HD](../carts/sunny-api-lab-hd/) adds an interactive
full-color, alpha, PNG, tint, crop, and scissor tour.
