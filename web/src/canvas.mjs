// The canvas presenter — the browser's surface on the verified framebuffer
// (the multi-presenter thesis, peer of the native terminal/window). A dumb,
// unverified sink: it maps each palette index to RGB and blits via ImageData.
// Nothing here affects the run's hash.
//
// DOM-only; imported by the PWA shell, never by the runtime or the Node gate.

/** Draw a Framebuffer to a 2D canvas context using the cart's palette. */
export function present(ctx, fb, palette, measure = false) {
  const started = measure ? performance.now() : 0;
  const img = ctx.createImageData(fb.w, fb.h);
  const d = img.data;
  if (fb.colorMode === 1) d.set(fb.px);
  else for (let i = 0; i < fb.px.length; i++) {
    const [r, g, b] = palette.rgb(fb.px[i]);
    const j = i * 4;
    d[j] = r;
    d[j + 1] = g;
    d[j + 2] = b;
    d[j + 3] = 255;
  }
  const converted = measure ? performance.now() : 0;
  ctx.putImageData(img, 0, 0);
  if (!measure) return null;
  const finished = performance.now();
  return { rgbMs: converted - started, canvasMs: finished - converted };
}

// Keyboard → button bit (ABI §4 Input). Arrow keys / WASD for the d-pad,
// Z/X for A/B, Enter for Start. The shell tracks the held set.
export const KEY_TO_BIT = {
  ArrowUp: 0, KeyW: 0,
  ArrowDown: 1, KeyS: 1,
  ArrowLeft: 2, KeyA: 2,
  ArrowRight: 3, KeyD: 3,
  KeyZ: 4, // A
  KeyX: 5, // B
  Enter: 6, // Start
};

export const EXTENDED_KEY_TO_BIT = {
  ArrowUp: 0,
  ArrowDown: 1,
  ArrowLeft: 2,
  ArrowRight: 3,
  KeyZ: 4, // A
  KeyX: 5, // B
  Enter: 6, // Start
  KeyA: 7, // X
  KeyS: 8, // Y
  KeyQ: 9, // L
  KeyW: 10, // R
};

// Standard Gamepad mapping → the same seven-button console face. Axes are
// deliberately ignored: drift/noise must not become input or change the
// adaptive system-cart legend. Back/Guide remain presenter shell actions.
const GAMEPAD_BUTTON_TO_BIT = [
  [12, 0], // d-pad up
  [13, 1], // d-pad down
  [14, 2], // d-pad left
  [15, 3], // d-pad right
  [0, 4],  // south / A
  [1, 5],  // east / B
  [9, 6],  // Start
  [2, 7],  // west / X
  [3, 8],  // north / Y
  [4, 9],  // left shoulder / L
  [5, 10], // right shoulder / R
];

export function readStandardGamepad(gamepad) {
  if (!gamepad || !gamepad.connected || gamepad.mapping !== "standard") {
    return { mask: 0, back: false, guide: false };
  }
  const pressed = (i) => !!gamepad.buttons?.[i]?.pressed;
  let mask = 0;
  for (const [button, bit] of GAMEPAD_BUTTON_TO_BIT) {
    if (pressed(button)) mask |= 1 << bit;
  }
  return { mask, back: pressed(8), guide: pressed(16) };
}
