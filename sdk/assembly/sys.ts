// sys — the `calyx.sys` bindings (ABI §4b). **SYSTEM CARTS ONLY.**
//
// Importing anything from this module makes the cart's .wasm import the
// `calyx.sys` module, which a normal cart load refuses at instantiation
// (link-time privilege). That is why this file is deliberately NOT
// re-exported from index.ts — privilege must be visible in a cart's
// import lines, never inherited by accident.

// @ts-ignore: decorator
@external("calyx.sys", "sys_cart_count")
declare function _sys_cart_count(): i32;
// @ts-ignore: decorator
@external("calyx.sys", "sys_input_method")
declare function _sys_input_method(): i32;
// @ts-ignore: decorator
@external("calyx.sys", "sys_cart_info")
declare function _sys_cart_info(i: i32, ptr: i32): i32;
// @ts-ignore: decorator
@external("calyx.sys", "sys_cart_icon")
declare function _sys_cart_icon(i: i32, ptr: i32): i32;
// @ts-ignore: decorator
@external("calyx.sys", "sys_launch")
declare function _sys_launch(i: i32): void;
// @ts-ignore: decorator
@external("calyx.sys", "sys_exit")
declare function _sys_exit(): void;

export enum InputMethod {
  KEYBOARD = 0,
  CONTROLLER = 1,
  TOUCH = 2,
}

/// One installed cart's metadata, decoded from the pinned binary record.
export class CartInfo {
  name: string = "";
  author: string = "";
  version: string = "";
  category: string = "Games";
}

// The capped ABI v1.2 record always fits here:
// 3 × (2 + 63) + (2 + 31) = 228 bytes (§4b).
const INFO_BUF = new StaticArray<u8>(256);

export function cart_count(): i32 {
  return _sys_cart_count();
}

/// The last meaningful presenter input used by the console. Headless feeds
/// script this value, so system UI remains deterministic.
export function input_method(): InputMethod {
  return <InputMethod>_sys_input_method();
}

/// Decode cart `i`'s record — (name, author, version, optional category), each
/// [u16-LE length][UTF-8 bytes]. An ABI v1.1 three-field record defaults to
/// category Games. Null when `i` is out of range.
export function cart_info(i: i32): CartInfo | null {
  const n = _sys_cart_info(i, changetype<i32>(INFO_BUF));
  if (n < 0) return null;
  const info = new CartInfo();
  let pos = 0;
  for (let field = 0; field < 3; field++) {
    const len = <i32>INFO_BUF[pos] | (<i32>INFO_BUF[pos + 1] << 8);
    pos += 2;
    const s = String.UTF8.decodeUnsafe(
      changetype<usize>(INFO_BUF) + pos, len,
    );
    if (field == 0) info.name = s;
    else if (field == 1) info.author = s;
    else info.version = s;
    pos += len;
  }
  if (pos < n) {
    const len = <i32>INFO_BUF[pos] | (<i32>INFO_BUF[pos + 1] << 8);
    pos += 2;
    info.category = String.UTF8.decodeUnsafe(
      changetype<usize>(INFO_BUF) + pos, len,
    );
  }
  return info;
}

/// Fetch cart `i`'s 64×64 icon (exactly 4096 index bytes) into `dst`,
/// ready for `blit_sprite(dst, 64, 64, x, y)`. False when out of range.
export function cart_icon(i: i32, dst: StaticArray<u8>): bool {
  assert(dst.length >= 4096, "icon buffer must be >= 4096 bytes");
  return _sys_cart_icon(i, changetype<i32>(dst)) == 4096;
}

/// Chainload cart `i`. Out-of-range traps (§4b). Headless, this records
/// a verified {op:"launch"} event and the run continues; in console
/// play the runner swaps carts.
export function launch(i: i32): void {
  _sys_launch(i);
}

/// Return to the launcher. Records a verified {op:"exit"} event.
export function exit(): void {
  _sys_exit();
}
