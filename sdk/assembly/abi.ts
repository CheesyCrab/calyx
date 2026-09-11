// abi — raw host imports for the locked ABI v1.6 surface (docs/ABI.md §4).
//
// Internal to Sunny: signatures mirror the contract exactly, nothing here
// interprets it. Authors use the CartBase-shaped face in `index.ts`; the
// raw wrappers are still exported for carts that need the metal.

// ── Raw ABI imports (host → cart), module "calyx" ──────────────────────
// @ts-ignore: decorator
@external("calyx", "frame")
export declare function _frame(): i32;
// @ts-ignore: decorator
@external("calyx", "width")
export declare function _width(): i32;
// @ts-ignore: decorator
@external("calyx", "height")
export declare function _height(): i32;
// @ts-ignore: decorator
@external("calyx", "cls")
export declare function _cls(idx: i32): void;
// @ts-ignore: decorator
@external("calyx", "pixel")
export declare function _pixel(x: i32, y: i32, idx: i32): void;
// @ts-ignore: decorator
@external("calyx", "rect")
export declare function _rect(x: i32, y: i32, w: i32, h: i32, idx: i32): void;
// @ts-ignore: decorator
@external("calyx", "hline")
export declare function _hline(x: i32, y: i32, w: i32, idx: i32): void;
// @ts-ignore: decorator
@external("calyx", "vline")
export declare function _vline(x: i32, y: i32, h: i32, idx: i32): void;
// @ts-ignore: decorator
@external("calyx", "text")
export declare function _text(
  x: i32, y: i32, ptr: i32, len: i32, idx: i32, scale: i32,
): void;
// @ts-ignore: decorator
@external("calyx", "blit")
export declare function _blit(
  ptr: i32, sw: i32, sh: i32, x: i32, y: i32, dw: i32, dh: i32, flags: i32,
): void;
// @ts-ignore: decorator
@external("calyx", "set_palette")
export declare function _set_palette(ptr: i32, count: i32): void;
// @ts-ignore: decorator
@external("calyx", "btn")
export declare function _btn(): i32;
// @ts-ignore: decorator
@external("calyx", "tone")
export declare function _tone(freq: i32, dur: i32, vol: i32, flags: i32): void;
// @ts-ignore: decorator
@external("calyx", "trace")
export declare function _trace(ptr: i32, len: i32): void;

// ABI v1.6 drawing. Color selection is once, in the real start() call only.
@external("calyx", "set_color_mode")
export declare function _set_color_mode(mode: i32): void;
@external("calyx", "rgba_cls")
export declare function _rgba_cls(rgba: i32): void;
@external("calyx", "rgba_rect")
export declare function _rgba_rect(x: i32, y: i32, w: i32, h: i32, rgba: i32): void;
@external("calyx", "rgba_text")
export declare function _rgba_text(x: i32, y: i32, ptr: i32, len: i32, rgba: i32, scale: i32): void;
@external("calyx", "clip")
export declare function _clip(x: i32, y: i32, w: i32, h: i32): void;
@external("calyx", "clip_reset")
export declare function _clip_reset(): void;
@external("calyx", "blit_region")
export declare function _blit_region(
  ptr: i32, sw: i32, sh: i32, sx: i32, sy: i32, rw: i32, rh: i32,
  x: i32, y: i32, dw: i32, dh: i32, flags: i32, tint: i32, opacity: i32,
): void;
