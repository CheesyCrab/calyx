# Calyx ABI — the cart contract

> **Status: ABI v1.6 — locked.** This is the authoritative contract between a
> cart (`.wasm`) and every Calyx runtime. The native Rust runtime, web
> JavaScript runtime, and Sunny AssemblyScript SDK implement this contract.
> The two runtimes share this specification, not implementation code. Every
> observable contract change requires an ABI version and a factual changelog
> entry. See [VERSIONING.md](VERSIONING.md) for the distinction between
> product, ABI, and component versions.

---

## 0. Model

The model is immediate-mode, single-threaded, and fixed-step. Each 60 Hz
simulation tick the runtime:

1. samples input into its own state,
2. calls the cart's `update()` export once,
3. makes the host framebuffer available to an unverified presenter.

Presentation cadence is not simulation cadence. A presenter may display every
tick or a subset of ticks; it never changes how often `update()` runs on the
simulation timeline.

There is no retained scene, no callback registration, no allocation
handshake. A cart is `start()` once, then `update()` per simulation tick. Drawing
happens *inside* `update()` via host functions; there is no separate
`draw()` export.

**The framebuffer lives in the host, not in cart memory.** The cart never
names a framebuffer address. It draws through host functions, so resolution
and color depth remain runtime-profile properties.

---

## 1. Default profile

These defaults define the Calyx console profile. They are *runtime
configuration with a pinned default*, not welded constants:
the cart cannot depend on any particular value beyond what
`width()`/`height()` report.

| Property      | v1 default             | Notes                          |
|---------------|------------------------|--------------------------------|
| Resolution    | 320 × 240              | reported by `width()` and `height()` |
| Framebuffer   | host-side, 8bpp indexed | one byte/pixel = palette index; cart writes via host fns only |
| Palette       | **SWEETIE_16 (16 colors)** | the Calyx default palette (see §1.1) |
| Simulation rate | fixed step, exactly 60 Hz | one `update()` per tick      |
| Frame step    | integer-counted        | no wall-clock exposed to cart  |
| Memory        | cart linear mem grows  | no 64 KB cap                   |

8bpp *storage* gives every cart up to 256 colors. SWEETIE_16 is the
**default** palette, not a cap: a cart may declare its own palette (≤256
entries) once at `start()` via `set_palette` (§4) — a cart is 16-color
when that is part of its *design*, not because the console forces it.
Sunny's named palettes (`MONO`, `GAMEBOY`, `GBA_WARM`, …) ship as data in
Sunny and lower through the same call (§4a).

### 1.1 The default palette (SWEETIE_16)

Sunny exposes these indices as its default color constants:

```
 0 BLACK    #000000     8 GREEN       #38b764
 1 WHITE    #ffffff     9 TEAL        #257179
 2 DARK_BLUE #1a1c2c   10 NAVY        #29366f
 3 PURPLE   #5d275d    11 BLUE        #3b5dc9
 4 RED      #b13e53    12 LIGHT_BLUE  #41a6f6
 5 ORANGE   #ef7d57    13 CYAN        #73eff7
 6 YELLOW   #ffcd75    14 LIGHT_GRAY  #94b0c2
 7 LIGHT_GREEN #a7f070 15 DARK_GRAY   #566c86
```

Index 0 (`BLACK`) is the default clear color.

The runtime can instantiate other framebuffer sizes. A cart must use
`width()` and `height()` instead of assuming the default dimensions.

---

## 2. Coordinate & color conventions

- Origin `(0,0)` is **top-left**; `x` grows right, `y` grows down.
- Indexed framebuffer pixels are **palette indices** `0..=255` (`u8`).
  Index 0 is the default clear value; the palette supplies its RGB color.
  True-color framebuffer pixels use canonical RGBA8888 bytes (§4).
- Indexed output writes an index or skips the pixel (`blit` color-key).
  Opt-in true-color output supports the integer source-over operations in
  §4 True color and compositing. Existing palette-index arguments never
  change meaning.
- Out-of-bounds draws are **clipped silently**, never an error or trap.
- All coordinates and sizes are **signed 32-bit** (`i32`) across the ABI
  so off-screen origins (negative `x`/`y`) clip naturally.

---

## 3. Cart exports (cart → host)

The cart `.wasm` **must** export:

```
start() -> ()        // called once after instantiation, before frame 0
update() -> ()       // called once per 60 Hz simulation tick; draw here
```

The cart's WASM linear memory must also be
exported as `memory` so the host can read string bytes for
`text`, pixel bytes for `blit`, and palette bytes for `set_palette`
(see §4).

**Determinism contract.** `update()` must be a pure function of frame index,
accumulated input, and cart-internal state. It must not read wall-clock time,
host random values, or any run-varying host value.

---

## 4. Host imports (host → cart)

Ordinary host functions are imported under module name **`calyx`**.

**The placement rule (host vs Sunny).** Every host import is permanent parity
surface: its clipping, rounding, and edge cases must be implemented
byte-identically in every runtime and guarded by conformance vectors. Sunny
code compiles into the cart, so the same guest implementation runs everywhere.
A primitive belongs host-side only when it needs host-owned data or measured
per-pixel-scale access. Functionality that lowers cheaply to existing imports
belongs in Sunny (§4a).

**Memory safety.** Every `ptr`/`len` (or `ptr` plus an implied record
size) the cart passes is validated against its exported `memory`; a
read or write that would fall outside it **traps immediately** — fail
fast, never a partial read. Pixel coordinates clip (§2); memory
violations trap. A trap faults the run (§6a).

### Frame / device

```
frame() -> i32          // monotonic 60 Hz simulation-tick counter, starts at 0
width()  -> i32         // framebuffer width  (320 in default profile)
height() -> i32         // framebuffer height (240 in default profile)
```

`frame()` is the *only* sanctioned source of time. It advances exactly once per
60 Hz simulation tick and is deterministic by construction, which is why it
replaces wall-clock. Presentation cadence is invisible to the cart.

### Drawing

```
cls(idx: i32) -> ()                          // clear whole fb to palette idx
pixel(x: i32, y: i32, idx: i32) -> ()        // single pixel
rect(x: i32, y: i32, w: i32, h: i32, idx: i32) -> ()   // filled rect
hline(x: i32, y: i32, w: i32, idx: i32) -> ()          // horizontal run
vline(x: i32, y: i32, h: i32, idx: i32) -> ()          // vertical run
text(x: i32, y: i32, ptr: i32, len: i32, idx: i32, scale: i32) -> ()
blit(ptr: i32, sw: i32, sh: i32, x: i32, y: i32,
     dw: i32, dh: i32, flags: i32) -> ()
```

- `text` reads `len` bytes from the cart's `memory` at `ptr` and
  renders with the built-in fixed font in palette color `idx`, at integer
  `scale` (1 = native `m6x11` glyphs, 2 = doubled, and so on;
  `scale < 1` is treated as 1). The host owns
  the font; no font upload. **Encoding:** bytes are UTF-8; glyphs exist
  for `0x20..=0x7E`; every other byte (control bytes, and each byte of
  a multi-byte sequence) renders the placeholder glyph and advances
  normally — the host never decodes UTF-8. **Clipping:** no
  width-in-glyphs cap; text clips per-pixel like every other draw op
  (§2). The font's glyph and advance-width tables are **ABI-pinned and
  versioned** (changing them breaks every golden): the canonical
  artifact is **`assets/fonts/m6x11-v1.json`** — cell 14 px tall
  (baseline at row 11), per-glyph `advance` + `bitmap` (one int per
  row, top to bottom, bit 0 = leftmost pixel), plus the pinned
  `placeholder` glyph.
  Hosts embed the bitmaps; Sunny embeds the advances to measure/center/
  wrap guest-side without a host metrics call. Text uses integer scales of the
  pinned pixel font only.
- `blit` copies an **8bpp indexed** source — `sw × sh` index bytes,
  row-major, stride `sw`, read from cart `memory` at `ptr` — to the
  framebuffer at `(x, y)` scaled to `dw × dh`. `flags`: bit 0 = flip-x,
  bit 1 = flip-y, bit 2 = color-key (source index 0 is transparent).
  Sprites are *baked into the cart* by the build-time `png2src` tool. The
  `.wasm` remains the single portable artifact; the runtime does not load PNGs.
  Nearest-neighbor scaling is supported: source coordinates are
  `floor(dx * sw / dw)` and `floor(dy * sh / dh)`, followed by the selected
  flips. Destination clipping does not change this mapping. Nonpositive
  destination sizes draw nothing after source memory validation. Intermediate
  arithmetic must not overflow or lose integer precision.
- `line`, `oval`/`circle`, and outlines are **not host imports** — they
  live in Sunny, per the placement rule (§4a).

### True color and compositing (v1.6)

Color is independent of resolution and input. Indexed output remains the
implicit default. A cart opts in from its actual `start()` export:

```text
set_color_mode(mode: i32) -> ()
rgba_cls(rgba: i32) -> ()
rgba_rect(x: i32, y: i32, w: i32, h: i32, rgba: i32) -> ()
rgba_text(x: i32, y: i32, ptr: i32, len: i32, rgba: i32, scale: i32) -> ()
clip(x: i32, y: i32, w: i32, h: i32) -> ()
clip_reset() -> ()
blit_region(ptr: i32, sw: i32, sh: i32,
            sx: i32, sy: i32, rw: i32, rh: i32,
            x: i32, y: i32, dw: i32, dh: i32,
            flags: i32, tint: i32, opacity: i32) -> ()
```

`set_color_mode` accepts 0 (indexed) or 1 (RGBA8888). It may be called once
only, during `start()`, not Wasm initialization or `update()`. Invalid modes
and repeat calls trap. It resets clipping and fills the framebuffer with
index 0 in indexed mode or `(0,0,0,255)` in true-color mode. Omitting the call
retains the original indexed behavior.

True-color pixels are opaque output stored as canonical R,G,B,A bytes, with
A always 255. The new `rgba_*` imports require true-color mode, including
empty or fully clipped draws; otherwise they trap. Packed colors use
`0xRRGGBBAA` bits in an i32. `rgba_cls` replaces every pixel's RGB, ignores
the supplied alpha and bypasses clipping. `rgba_rect` and `rgba_text` blend
source-over; text keeps the existing font, byte decoding and scale rules.
Sunny pixels and other helpers lower to these operations.

Existing drawing imports keep their palette-index arguments. In true-color
mode they resolve the index through the current palette and write opaque RGB.
A later `set_palette` during `start()` affects subsequent indexed draws only;
it does not recolor already resolved true-color pixels. Indexed framebuffer
palette behavior is unchanged.

`clip` replaces the current scissor with its intersection with the screen.
Nonpositive width or height makes it empty. `clip_reset` restores the screen.
The scissor persists across updates. Every drawing operation respects it
except `cls` and `rgba_cls`; clearing does not change the scissor. Endpoint
arithmetic is overflow-safe. There is no implicit clip stack.

`blit_region` selects a source rectangle from a row-major sheet, then scales
and flips within that rectangle. Flags are bit 0 flip-x, bit 1 flip-y,
bit 2 skip indexed source value 0, and bit 3 RGBA-byte source. Unknown bits,
or color-key together with RGBA source, trap. Indexed source pixels occupy
one byte; RGBA source pixels occupy four straight-alpha R,G,B,A bytes.

All source dimensions and source coordinates must be nonnegative and the
selected rectangle must fit inside the sheet. The entire sheet memory range
is limited to 2,147,483,647 bytes and validated with checked multiplication
before drawing, even for empty,
fully clipped, or zero-opacity output. Invalid source bounds or memory trap.
Zero source-region extents or nonpositive destination extents draw nothing
after validation. Mapping is `sx + floor(dx * rw / dw)` and
`sy + floor(dy * rh / dh)`, with flips applied inside the selected region.
Only visible destination pixels are visited, using exact integer arithmetic.

`tint` is `0xRRGGBB` with a zero high byte; `opacity` is 0 through 255.
Other values trap. Indexed output accepts only indexed sources with white
tint (`0xffffff`) and opacity 255. Unsupported combinations trap even when
no destination pixel would be written. True-color output accepts both formats;
indexed source colors resolve through the current palette, with source alpha
255, after any index-zero color-key test.

For each encoded RGB channel, in this exact order:

```text
tinted = floor((source * tintChannel + 127) / 255)
alpha  = floor((sourceAlpha * opacity + 127) / 255)
output = floor((tinted * alpha + destination * (255 - alpha) + 127) / 255)
```

Rectangle and text colors use their packed alpha directly, without tint or
additional opacity. Output alpha is always 255. Blending uses encoded byte
values, with no linear-light conversion, premultiplication or floating-point
rounding. Filtering, rotation and other blend modes remain unsupported.

### Palette

```
set_palette(ptr: i32, count: i32) -> ()      // start()-only
```

Reads `count` (≤ 256) packed RGB888 triples (`3 × count` bytes) from
cart `memory` at `ptr` and replaces the palette from index 0. **Valid
only during `start()`**; a call during `update()` traps — the palette
is fixed for the run, which keeps output deterministic and lets the
dump record it once (§6a). Carts that never call it get SWEETIE_16
(§1.1). The framebuffer hash is over *index* bytes, so the palette is
recorded in `status.json` as verified state in its own right.

### Input

```
btn() -> i32            // bitmask of currently-held buttons
```

Bit layout (LSB first). Classic carts use bits 0-6. The additive extended
digital profile uses bits 7-10 without moving the Classic assignments:

| Bit | Button | Bit | Button |
|-----|--------|-----|--------|
| 0   | Up     | 6   | Start  |
| 1   | Down   | 7   | X      |
| 2   | Left   | 8   | Y      |
| 3   | Right  | 9   | L      |
| 4   | A      | 10  | R      |
| 5   | B      | —   | —      |

`btn()` returns *held* state. Edge detection (just-pressed /
just-released) is the cart's job: compare against last frame's value
stored in cart memory. The host does not track per-cart edges.

### Audio

```
tone(freq: i32, dur: i32, vol: i32, flags: i32) -> ()
```

`freq` is in Hz, `dur` is in frames, and `vol` is 0–100. `flags` uses this
bit packing:

| Bits  | Field    | Values                                          |
|-------|----------|-------------------------------------------------|
| 0–1   | waveform | `0` square, `1` triangle, `2` sine, `3` noise   |
| 2–3   | channel  | `0`–`3`                                         |
| 4–31  | reserved | **must be zero — nonzero traps** |

Sunny's music layer (`set_drums`/`set_melody`/`play_music`) is a sequencer
that lowers to per-frame `tone` calls (§4a) — no host-side music state.

**Audio is verified as events, not samples.** An audio call drives a presenter
(synthesis to speaker, unverified like a window) and appends a frame-stamped
**event** to the headless dump (§6a) — `{op:"tone", freq, dur, vol, flags}`.
Sunny's `sfx` presets produce these same tone events; there is no separate
host `sfx` event. The
golden verifies the *event stream* ("did the cart request the right sound on
the right frame?"), never the waveform. Sample-for-sample parity across the
browser `AudioContext` and a native backend is not attemptable; the event
stream is deterministic and runtime-identical. This is the audio case of the
verification boundary: audio events sit beside `trace` on the verified side;
playback sits beside the window on the presenter side.

### Debug / logging

```
trace(ptr: i32, len: i32) -> ()   // attach a string to this frame's log
```

Reads `len` ASCII bytes from cart `memory` at `ptr` and appends them to
the **current frame's** `trace` list in the headless dump (§6a). This is
the cart's knob for *choosing what to log* — game state, its own view of
input, whatever — without the host prescribing a schema. Both runtimes
collect traces during interactive play too, even when the presenter does not
display or save them. Keep logging modest in busy loops: strings still cost
work. Deterministic: same frame, same string.

---

## 4a. Sunny — the guest-side authoring face

The raw ABI uses small host operations such as `cls`, `rect`, `text`, and
`btn`. Sunny wraps them with cart lifecycle functions, drawing helpers, input
edge detection, palettes, deterministic random numbers, text metrics, screen
helpers, and a music sequencer.

Sunny geometry lowers to `pixel`, `hline`, and `vline`; sprites are compiled
into cart memory and lower to `blit`; input edges are state held in the cart;
and sequenced music lowers to frame-stamped `tone` calls. None of these helpers
adds a host import.

Numeric modeling also remains guest-side. Carts may use integers, cart-local
fixed point, or verified finite-domain `f64` under
[`FLOAT_POLICY.md`](FLOAT_POLICY.md), with integer quantization at observable
boundaries.

---

## 4b. `calyx.sys` — the system-cart surface

The launcher and settings pages are **ordinary Sunny carts** that additionally
import module **`calyx.sys`**. The privilege boundary is the module name,
enforced at instantiation: a
normal cart whose `.wasm` imports `calyx.sys` is a **load error**. No
capability flags, no runtime checks — system carts are simply the ones
the runtime *chooses* to link against the extra module.

```
sys_cart_count() -> i32
sys_input_method() -> i32                  // KEYBOARD=0 CONTROLLER=1 TOUCH=2
sys_cart_info(i: i32, ptr: i32) -> i32   // writes metadata into cart mem
sys_cart_icon(i: i32, ptr: i32) -> i32   // writes 8bpp indexed icon pixels
sys_launch(i: i32) -> ()                  // chainload cart i
sys_exit() -> ()                          // back to launcher
```

- Metadata (name/author/version/category) comes from each cart's `cart.toml`
  manifest. **`sys_cart_info` record
  (pinned):** a fixed binary layout written at `ptr` — four fields in
  order (**name, author, version, category**), each `[u16-LE
  length][UTF-8 bytes]`. Returns total bytes written, or `-1` if `i` is out of
  range. No JSON in cart memory: a parser inside every system cart is
  exactly the dependency the binary record avoids. **Field cap
  (v1.1/v1.2):** name, author, and version are each ≤ **63 UTF-8 bytes**;
  category is ≤ **31 UTF-8 bytes**. A longer
  manifest value is a host-side configuration error at load, never a
  truncation — so a 256-byte guest buffer always fits the record
  (max `3 × (2 + 63) + (2 + 31) = 228` bytes) and the host never overruns
  a well-sized buffer. ABI v1.2 appends category: a v1.1 decoder ignores the
  trailing bytes; a v1.2 decoder receiving the three-field v1.1 record defaults
  category to `Games`. The write is validated against cart memory like every
  `ptr` (§4 Memory safety).
- `sys_input_method()` returns the last **meaningful console input event** as
  `KEYBOARD=0`, `CONTROLLER=1`, or `TOUCH=2`. Accepted keyboard/controller
  button or touch-control actions change it; connection/hotplug and axis noise
  do not. This is explicit verified input context, not presenter decoration:
  headless feeds script it, old feeds default to keyboard, and system-cart
  framebuffer changes remain deterministic. It is system-only; ordinary carts
  do not gain a general device-discovery API.
- `sys_cart_icon` writes a **64 × 64** 8bpp indexed icon (exactly
  4096 index bytes, row-major) into cart memory at `ptr`; returns
  `4096`, or `-1` if `i` is out of range. The launcher then draws it
  with the ordinary `blit` — no new draw ops.
- `sys_launch(i)` with `i` out of range **traps** (fail fast — a
  launcher bug, not a soft error). `sys_launch`/`sys_exit` are
  **verified state**: each call appends a frame-stamped event to the
  headless dump's `sys` array (§6a) — `{op:"launch","i":N}` /
  `{op:"exit"}` — so the launcher's behavior is golden-testable.
  Headless, the run records the event and continues (there is nothing
  to chainload); in console play the runner acts on it (swap carts /
  return to launcher). The `sys` key exists **only in privileged
  runs**, so no pre-v1.1 golden can see it.
- **Settings are transient in v1** and remain in cart memory for the session.
  The ABI contains no persistence import.
- **Determinism survives:** the installed-cart list is just another
  input. Headless runs script it in the feed (the object feed form's
  `carts` key, §6a), so even the launcher is golden-testable.

---

## 5. Unsupported behavior

ABI v1 does not include:

- a `draw()` export separate from `update()`,
- blend modes other than the specified true-color source-over operation,
- palette writes after `start()`,
- rotated or affine blits, tiled background layers, or host parallax,
- a raw framebuffer memory region exposed to the cart,
- host-side `line`/`oval`/`circle` (guest-side in Sunny, §4 placement
  rule),
- disk or persistence,
- network or AI-service access,
- any callback the cart registers with the host.

These omissions are contract boundaries, not partially implemented imports.
Product versions do not pre-assign ABI versions.

---

## 6. Worked example — the gate cart, in ABI terms

A frame-counter checkerboard that scrolls one cell per frame, fully
deterministic:

```
start():
    (nothing; no state to seed)

update():
    f   = frame()
    cls(0)
    cell = 16
    cols = width()  / cell
    rows = height() / cell
    for cy in 0..rows:
        for cx in 0..cols:
            on = ((cx + cy + f / 8) & 1) == 1
            if on:
                rect(cx*cell, cy*cell, cell, cell, 1)
    // a one-cell marker that moves with held Right, to exercise btn()
    if (btn() & (1 << 3)) != 0:
        rect((f % cols) * cell, 0, cell, cell, 4)
    // cart chooses what lands in frames.jsonl (§6a)
    trace("mode=CHECKER")
    trace("scroll=" + (f / 8))
```

Because the only time source is `frame()` and the only input is `btn()`,
the headless dump at frame `N` (with a scripted input log) is reproducible
byte-for-byte → it can be committed as a golden and asserted in CI.

---

## 6a. Headless I/O formats

Two artifacts surround a headless run: the scripted **input** fed in, and
the **state dump** written out. They share one vocabulary — buttons are
named (`UP DOWN LEFT RIGHT A B START`, plus `X Y L R` for extended input),
never raw bitmask, in both
directions.

**The verification boundary.** The verified state of a run is: the
framebuffer (as per-frame hashes), the palette, and the
per-frame event stream — input echo, `audio` events, `trace` lines,
and any fault. Presenters (window, speaker, terminal glass, canvas)
are dumb, **unverified** sinks fed *from* that state. Moving anything
across this line — either direction — is an ABI change (§7), not a
host detail.

### Input — scripted feed (`*.in.json`)

A **sparse keyframe list**: each entry sets the held-button set at a frame,
and that set persists until the next entry. Frames not mentioned inherit
the previous hold set; the implicit start is "nothing held."

```json
[
  { "f": 0,  "hold": ["RIGHT"] },
  { "f": 10, "hold": [] },
  { "f": 15, "hold": ["A", "RIGHT"] }
]
```

Reads as "hold Right from frame 0, release at 10, press A+Right at 15."
The runtime decodes each entry to the `btn()` bitmask the cart sees that
frame. Entries must be ordered by ascending `f`. Names are
case-insensitive; an unknown name is a load error (fail fast, not silent).

The bare array is shorthand for the **object form**. System carts
(§4b) need one more scripted input — the installed-cart list — so a
feed may instead be:

```json
{
  "carts": [
    {
      "name": "checker", "author": "Cheesy Crab", "version": "0.1.0",
      "category": "Demos"
    }
  ],
  "input": [
    { "f": 0, "hold": ["RIGHT"], "method": "CONTROLLER" }
  ]
}
```

`carts[i]` feeds `sys_cart_count`/`sys_cart_info`; absent category defaults to
`Games`. An optional `icon`
per entry is base64 of exactly 4096 bytes (the 64 × 64 indices for
`sys_cart_icon`); when absent the host substitutes the **pinned
placeholder**: all 4096 bytes equal to `(i % 15) + 1`. For a normal
cart the `carts` key is ignored.

An input keyframe may independently include `method` = `KEYBOARD`,
`CONTROLLER`, or `TOUCH`. Like `hold`, the last declared method persists; unlike
`hold`, omitting `method` from a later keyframe leaves the previous method
unchanged. Before the first method entry (and in every pre-v1.2 feed), the
method is `KEYBOARD`. Unknown method names are a load error.

`calyx run --cart cart.wasm --present headless --frames N --in feed.in.json --out <dir>`.

### Output — two-tier state dump

Quick status is one small file; the deep per-frame record is a separate
stream for digging into a run.

**`status.json`** — scanned first; this is what the golden test diffs:

```json
{
  "cart": "checker",
  "profile": { "w": 320, "h": 240, "palette": "SWEETIE_16" },
  "frames_run": 30,
  "run_hash": "8d36f4ed22907d2a",
  "final_hash": "5b1d3c2a9e8f1706",
  "input": "checker.in.json"
}
```

- **Hash algorithm (pinned):** FNV-1a **64-bit** — offset basis
  `0xcbf29ce484222325`, prime `0x100000001b3` — rendered as 16
  lowercase hex chars. `frame_hash` is FNV-1a over the framebuffer's
  index bytes in row-major order for indexed mode, or canonical RGBA bytes
  (including the opaque alpha byte) in true-color mode. `run_hash` is FNV-1a over every
  frame's `frame_hash` as 8 **little-endian** bytes, concatenated in
  frame order. `final_hash` is the last frame's `frame_hash`.
  **`run_hash` is the verification gate** — a mid-run divergence that
  self-heals by the last frame would pass a final-only check; `final_hash` is a
  convenience. These constants are pinned here and reproduced by both
  runtimes.
- True-color status adds `profile.color = "rgba8888"`. Indexed status omits
  this field to preserve existing reports.
- `profile.palette` records the palette as verified state: the default
  name (`"SWEETIE_16"`) or, when the cart called `set_palette`,
  `"custom:<digest>"` where `<digest>` is the same FNV-1a-64 over the
  declared `3 × count` RGB bytes — the index hash alone cannot see
  palette changes (§4 Palette).
- **Faults are verified state.** If the cart traps — a wasm trap, AS
  `abort`, a memory-safety violation (§4), nonzero reserved `tone`
  bits, or `set_palette` during `update()` — the run stops and
  `status.json` carries `"fault": { "f": N, "kind": "trap"|"abort",
  "msg": "…" }`. A faulted run never matches a golden; `msg` is
  informational (runtime-flavored) and never compared.

**`frames.jsonl`** — one JSON object per line, **one line per frame**
(every frame is the v1 default *and* the conformance requirement;
any sampling flag is presenter-side convenience, never
golden-affecting); grep- and line-diff-friendly, ignored unless
debugging:

```
{"f":0,"hash":"00aa11223344cc77","btn":[],"audio":[],"trace":["mode=CHECKER","scroll=0"]}
{"f":8,"hash":"3f9c20d1e2b4a586","btn":["RIGHT"],"audio":[],"trace":["mode=CHECKER","scroll=1"]}
```

- `btn` is the decoded held set that frame (echoes the input vocabulary).
- `trace` is the array of strings the cart emitted via `trace()` (§4),
  in call order. Empty array if the cart logged nothing.
- `audio` is the array of audio events the cart requested that frame —
  `{op:"tone", freq, dur, vol, flags}` — so audio is verified as intent
  on the framebuffer's side of the boundary (§4 Audio). Empty array if
  the cart played nothing; the key is always present from v1.0.
- `sys` (v1.1) is the array of system events the cart requested that
  frame — `{op:"launch","i":N}` / `{op:"exit"}` (§4b), verified as
  intent exactly like `audio`. The key is present on **every** row of
  a privileged run (empty array when quiet) and **absent** from
  normal-cart dumps — which is why v1.1 is additive: no pre-v1.1
  golden can see it.

**PNG sidecars** — `frame_NNNN.png` for the final frame (and every Nth if
`--every N` is given), palette applied, for eyeballing.

The golden fixture for a cart is therefore: its `*.in.json`, the expected
`status.json`, and (optionally) an expected `frame_NNNN.png`. The test
asserts `status.json` equality first (cheap, decisive); `frames.jsonl` is
for diagnosing *where* a run diverged.

---

## 7. Version and changelog

**Current: ABI v1.6.**

**Change discipline.** Every observable change to this contract bumps
the version and lands a changelog line here, in the same commit.
Additive, backward-compatible surface is a minor bump. That includes a new
optional import or trailing record field that old carts and runtimes can
ignore. A change to what an existing cart observes without opting into new
surface—draw semantics, the font, the hash, or an existing dump field—is an
incompatible change. It must land with updated conformance vectors, both
runtimes green, and a deliberate re-bless.

### Changelog

- **v1.6** — adds start-time true-color selection, deterministic source-over
  drawing, clipping, source-region sprites, tint and opacity. Pins nearest-
  neighbor scaling. Existing indexed arguments, default storage and hashes
  remain unchanged. True-color reports identify canonical RGBA8888 output.

- **v1.5** — appends the named X, Y, L, and R digital inputs at button bits
  7-10. The `btn()` signature and Classic bits 0-6 are unchanged. Native,
  web, Sunny edge helpers, scripted feeds, and standard-gamepad presenters
  use the same names and assignments. Framebuffer dimensions remain
  runtime-profile configuration rather than a new import or ABI dialect.
- **v1.4** — the fixed simulation step is exactly 60 Hz on every runtime and
  presenter. Native `--fps` controls only 30/60 Hz presentation; audio
  duration, scripted input, and `frame()` remain on the 60 Hz simulation
  timeline. No import, export, record, hash, or cart-facing `delta` was added.
- **v1.3** — launcher icons are fixed at 64 × 64 indexed pixels:
  `sys_cart_icon` writes and returns exactly 4096 bytes, feeds/catalogs validate
  that size, and the launcher presents the selected icon natively while deriving
  its 32 × 32 and 16 × 16 neighbors.
- **v1.2** — `sys_cart_info` appends the
  optional 31-byte `category` field while preserving the v1.1 three-field
  prefix and 256-byte buffer; old decoders ignore it and new decoders default
  an old record to `Games`. New `sys_input_method()` reports the explicitly
  scripted last meaningful `KEYBOARD`/`CONTROLLER`/`TOUCH` input so verified
  system UI can choose accurate prompts. Native, web, Sunny, and headless feed
  parsing use the same values. Ordinary-cart surface and pre-v1.2 cart
  behavior are unchanged.
- **v1.1** — adds the enforced `calyx.sys` surface: link-time privilege, the
  binary info record with the 63-byte field cap, icon placeholder,
  out-of-range `sys_launch` trap, and the per-frame `sys` event
  array (§6a). The `sys` key exists only in privileged runs, so normal-cart
  dump shapes are unchanged.
- **v1.0** — initial contract. It includes `vline`,
  the `text` `scale` parameter + real `m6x11`, full `blit`,
  `set_palette`, the real 4-arg `tone`, the `calyx.sys` module, the
  object feed form (`carts`), the always-present `audio` key, and the
  `fault` record.
