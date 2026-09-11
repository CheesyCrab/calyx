// Input — the Classic face plus the extended digital buttons (ABI §4, §6a).
//
// Buttons are named everywhere they cross a boundary; the host reports held
// level only (edge detection is the cart's job, done in Sunny).

export const BUTTONS = ["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "START", "X", "Y", "L", "R"];
export const INPUT_METHOD = Object.freeze({ KEYBOARD: 0, CONTROLLER: 1, TOUCH: 2 });

export function inputMethodFromName(name) {
  const key = String(name).toUpperCase();
  if (Object.hasOwn(INPUT_METHOD, key)) return INPUT_METHOD[key];
  throw new Error(`unknown input method '${name}'`);
}

// Presenter shell keys, deliberately outside the seven-button cart ABI.
// Escape is never overloaded; Backspace only has meaning inside a
// chainloaded cart.
export function shellAction(code, inLauncher) {
  if (code === "Escape") return "quit";
  if (code === "Backspace" && !inLauncher) return "home";
  return null;
}

export function names(mask) {
  const out = [];
  for (let b = 0; b < BUTTONS.length; b++) if (mask & (1 << b)) out.push(BUTTONS[b]);
  return out;
}

export function maskFromNames(list) {
  let mask = 0;
  for (const n of list) {
    const bit = BUTTONS.indexOf(String(n).toUpperCase());
    if (bit < 0) throw new Error(`unknown button '${n}'`);
    mask |= 1 << bit;
  }
  return mask;
}

// Parse the feed's `carts` key (object form, ABI §4b/§6a) into the
// scripted installed-cart list a privileged run serves. Validates the
// ABI metadata caps and the exact-4096-byte icon, fail-fast.
export function parseCarts(json) {
  const list = (json && !Array.isArray(json) && json.carts) || [];
  const enc = new TextEncoder();
  return list.map((e) => {
    const cart = {
      name: String(e.name ?? ""),
      author: String(e.author ?? ""),
      version: String(e.version ?? ""),
      category: String(e.category ?? "Games"),
      icon: null,
    };
    for (const k of ["name", "author", "version"]) {
      if (enc.encode(cart[k]).length > 63) {
        throw new Error(`cart ${k} '${cart[k]}' exceeds the 63-byte ABI cap (§4b)`);
      }
    }
    if (enc.encode(cart.category).length > 31) {
      throw new Error(`cart category '${cart.category}' exceeds the 31-byte ABI cap (§4b)`);
    }
    if (e.icon != null) {
      const bin = atob(String(e.icon));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      if (bytes.length !== 4096) {
        throw new Error(`cart '${cart.name}' icon must be exactly 4096 bytes, got ${bytes.length}`);
      }
      cart.icon = bytes;
    }
    return cart;
  });
}

// Parse a feed (bare array or { input, carts } object form) into a function
// frame -> held bitmask. The `carts` key is parsed by `parseCarts`.
export function parseFeed(json) {
  const input = Array.isArray(json) ? json : (json && json.input) || [];
  const keys = input
    .map((e) => [e.f | 0, maskFromNames(e.hold || [])])
    .sort((a, b) => a[0] - b[0]);
  return (frame) => {
    let mask = 0;
    for (const [f, m] of keys) {
      if (f <= frame) mask = m;
      else break;
    }
    return mask;
  };
}

// Parse the optional ABI v1.2 input-method keyframes carried alongside held
// buttons. Old/bare feeds deterministically read as keyboard throughout.
export function parseInputMethods(json) {
  const input = Array.isArray(json) ? json : (json && json.input) || [];
  const keys = input
    .filter((e) => e.method != null)
    .map((e) => [e.f | 0, inputMethodFromName(e.method)])
    .sort((a, b) => a[0] - b[0]);
  return (frame) => {
    let method = INPUT_METHOD.KEYBOARD;
    for (const [f, m] of keys) {
      if (f <= frame) method = m;
      else break;
    }
    return method;
  };
}
