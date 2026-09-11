// Presenter-local input aggregation. Keyboard, Gamepad, and touch
// presenter all meet here before one held mask crosses into the runtime.

import { INPUT_METHOD } from "./input.mjs";
import { EXTENDED_KEY_TO_BIT, KEY_TO_BIT, readStandardGamepad } from "./canvas.mjs";

export class PresenterInput {
  constructor({ inputProfile = "classic" } = {}) {
    if (!["classic", "extended"].includes(inputProfile)) {
      throw new Error(`unknown input profile '${inputProfile}'`);
    }
    this.inputProfile = inputProfile;
    this.keyboard = new Set();
    this.gamepadMask = 0;
    this.touchMask = 0;
    this.previousPad = readStandardGamepad(null);
    this.suppressGamepadUntilRelease = false;
    this.cleanupHooks = new Set();
  }

  addCleanupHook(hook) {
    this.cleanupHooks.add(hook);
    return () => this.cleanupHooks.delete(hook);
  }

  setInputProfile(inputProfile) {
    if (!["classic", "extended"].includes(inputProfile)) {
      throw new Error(`unknown input profile '${inputProfile}'`);
    }
    this.clear({ suppressGamepad: true });
    this.inputProfile = inputProfile;
  }

  allowedMask() {
    return this.inputProfile === "extended" ? 0x7ff : 0x7f;
  }

  keyDown(code) {
    const bit = (this.inputProfile === "extended" ? EXTENDED_KEY_TO_BIT : KEY_TO_BIT)[code];
    if (bit === undefined) return { accepted: false, method: null };
    this.keyboard.add(bit);
    return { accepted: true, method: INPUT_METHOD.KEYBOARD };
  }

  keyUp(code) {
    const bit = (this.inputProfile === "extended" ? EXTENDED_KEY_TO_BIT : KEY_TO_BIT)[code];
    if (bit === undefined) return false;
    this.keyboard.delete(bit);
    return true;
  }

  pollGamepad(gamepad) {
    const rawPad = readStandardGamepad(gamepad);
    const pad = { ...rawPad, mask: rawPad.mask & this.allowedMask() };
    let pressedMask = pad.mask & ~this.previousPad.mask;
    let meaningful = pressedMask !== 0 ||
      (pad.back && !this.previousPad.back) ||
      (pad.guide && !this.previousPad.guide);
    let backPressed = pad.back && !this.previousPad.back;
    let guidePressed = pad.guide && !this.previousPad.guide;
    this.previousPad = pad;

    if (this.suppressGamepadUntilRelease) {
      if (pad.mask === 0 && !pad.back && !pad.guide) {
        this.suppressGamepadUntilRelease = false;
      }
      this.gamepadMask = 0;
      meaningful = false;
      backPressed = false;
      guidePressed = false;
      pressedMask = 0;
    } else {
      this.gamepadMask = pad.mask;
    }
    return {
      meaningful,
      method: meaningful ? INPUT_METHOD.CONTROLLER : null,
      backPressed,
      guidePressed,
      pressedMask,
    };
  }

  heldMask() {
    let mask = this.gamepadMask | this.touchMask;
    for (const bit of this.keyboard) mask |= 1 << bit;
    return mask;
  }

  setTouchMask(mask) {
    this.touchMask = mask & this.allowedMask();
  }

  clear({ suppressGamepad = false } = {}) {
    this.keyboard.clear();
    this.gamepadMask = 0;
    this.touchMask = 0;
    if (suppressGamepad) this.suppressGamepadUntilRelease = true;
    for (const hook of this.cleanupHooks) hook();
  }
}
