// Presenter-only pointer state for Calyx's Classic and extended console faces.
// Geometry and ownership live here so touch behavior can be proved without a
// browser or runtime. DOM binding is intentionally a thin layer below.

export const TOUCH_BITS = Object.freeze({
  up: 0,
  down: 1,
  left: 2,
  right: 3,
  a: 4,
  b: 5,
  start: 6,
  x: 7,
  y: 8,
  l: 9,
  r: 10,
});

const INPUT_PROFILES = new Set(["classic", "extended"]);
const EXTENDED_FADE_MS = 1700;

const DIRECTIONS = [
  ["right"],
  ["right", "down"],
  ["down"],
  ["down", "left"],
  ["left"],
  ["left", "up"],
  ["up"],
  ["up", "right"],
];

function bits(names) {
  let mask = 0;
  for (const name of names) mask |= 1 << TOUCH_BITS[name];
  return mask;
}

export function dpadMaskAt(rect, clientX, clientY, deadZone = 0.22) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
  const nx = (clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
  const ny = (clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
  if (Math.hypot(nx, ny) <= deadZone) return 0;
  const angle = Math.atan2(ny, nx);
  const sector = Math.round(angle / (Math.PI / 4));
  return bits(DIRECTIONS[(sector + 8) % 8]);
}

export class TouchState {
  constructor(onChange = () => {}) {
    this.pointers = new Map();
    this.onChange = onChange;
  }

  set(pointerId, surface, mask) {
    const previous = this.pointers.get(pointerId);
    if (!surface) this.pointers.delete(pointerId);
    else this.pointers.set(pointerId, { surface, mask });
    const changed = previous?.surface !== surface || previous?.mask !== mask;
    if (changed) this.onChange(this.heldMask(), this.pressed());
    return changed;
  }

  release(pointerId) {
    if (!this.pointers.delete(pointerId)) return false;
    this.onChange(this.heldMask(), this.pressed());
    return true;
  }

  clear() {
    if (this.pointers.size === 0) return false;
    this.pointers.clear();
    this.onChange(0, new Set());
    return true;
  }

  heldMask() {
    let mask = 0;
    for (const pointer of this.pointers.values()) mask |= pointer.mask;
    return mask;
  }

  pressed() {
    const names = new Set();
    const mask = this.heldMask();
    for (const [name, bit] of Object.entries(TOUCH_BITS)) {
      if (mask & (1 << bit)) names.add(name);
    }
    return names;
  }
}

function inside(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export class TouchControls {
  constructor(root, {
    onMask = () => {},
    onMeaningful = () => {},
    onHome = () => {},
    vibrate = (duration) => globalThis.navigator?.vibrate?.(duration),
  } = {}) {
    this.root = root;
    this.onMask = onMask;
    this.onMeaningful = onMeaningful;
    this.onHome = onHome;
    this.vibrate = vibrate;
    this.inputProfile = "classic";
    this.fadeTimer = 0;
    this.fadeGeneration = 0;
    this.trails = [];
    this.activePointers = new Set();
    this.state = new TouchState((mask, pressed) => {
      this.onMask(mask);
      this.paintPressed(pressed);
    });
    this.render();
    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerEnd = (event) => this.pointerEnd(event);
    this.onLostCapture = (event) => {
      this.activePointers.delete(event.pointerId);
      this.state.release(event.pointerId);
      this.wake();
    };
    this.onNativeTouch = (event) => {
      if (event.cancelable) event.preventDefault();
    };
    this.onNativeInterruption = (event) => {
      if (event.cancelable) event.preventDefault();
      this.clear();
    };
    this.onPageHide = () => this.clear();
    this.onVisibility = () => {
      if (document.hidden) this.clear();
    };
    root.addEventListener("pointerdown", this.onPointerDown);
    root.addEventListener("pointermove", this.onPointerMove);
    root.addEventListener("pointerup", this.onPointerEnd);
    root.addEventListener("pointercancel", this.onPointerEnd);
    root.addEventListener("lostpointercapture", this.onLostCapture);
    root.addEventListener("touchstart", this.onNativeTouch, { passive: false });
    root.addEventListener("touchmove", this.onNativeTouch, { passive: false });
    root.addEventListener("selectstart", this.onNativeInterruption);
    root.addEventListener("contextmenu", this.onNativeInterruption);
    root.addEventListener("dragstart", this.onNativeInterruption);
    // Safari can drop pointer capture when a native gesture interrupts a
    // touch. Window-level terminal events are the fallback that keeps a
    // release outside the control root from stranding the logical mask.
    addEventListener("pointerup", this.onPointerEnd, true);
    addEventListener("pointercancel", this.onPointerEnd, true);
    addEventListener("blur", this.onPageHide);
    addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  render() {
    const classic = `
      <div class="touch-dpad" data-surface="dpad" role="group" aria-label="Direction pad">
        <span class="dpad-arm dpad-up" data-pressed="up" aria-hidden="true">▲</span>
        <span class="dpad-arm dpad-left" data-pressed="left" aria-hidden="true">◀</span>
        <span class="dpad-center" aria-hidden="true"></span>
        <span class="dpad-arm dpad-right" data-pressed="right" aria-hidden="true">▶</span>
        <span class="dpad-arm dpad-down" data-pressed="down" aria-hidden="true">▼</span>
      </div>
      <div class="touch-system" aria-label="Console controls">
        <button class="touch-mini touch-home" data-shell="home" type="button" aria-label="Return home">
          <span aria-hidden="true">⌂</span><small>HOME</small>
        </button>
        <button class="touch-mini touch-start" data-surface="start" data-pressed="start" type="button" aria-label="Menu">
          <span aria-hidden="true">☰</span><small>MENU</small>
        </button>
      </div>
      <div class="touch-actions" aria-label="Action buttons">
        <button class="touch-action touch-b" data-surface="b" data-pressed="b" type="button" aria-label="B button">B</button>
        <button class="touch-action touch-a" data-surface="a" data-pressed="a" type="button" aria-label="A button">A</button>
      </div>
      <div class="touch-trails" aria-hidden="true"></div>`;
    const extended = `
      <div class="touch-shoulders" aria-label="Shoulder buttons">
        <button class="touch-shoulder touch-l" data-surface="l" data-pressed="l" type="button" aria-label="L shoulder button">L</button>
        <button class="touch-shoulder touch-r" data-surface="r" data-pressed="r" type="button" aria-label="R shoulder button">R</button>
      </div>
      <div class="touch-dpad" data-surface="dpad" role="group" aria-label="Direction pad">
        <span class="dpad-arm dpad-up" data-pressed="up" aria-hidden="true">▲</span>
        <span class="dpad-arm dpad-left" data-pressed="left" aria-hidden="true">◀</span>
        <span class="dpad-center" aria-hidden="true"></span>
        <span class="dpad-arm dpad-right" data-pressed="right" aria-hidden="true">▶</span>
        <span class="dpad-arm dpad-down" data-pressed="down" aria-hidden="true">▼</span>
      </div>
      <div class="touch-system" aria-label="Console controls">
        <button class="touch-mini touch-home" data-shell="home" type="button" aria-label="Return home">
          <span aria-hidden="true">⌂</span><small>HOME</small>
        </button>
        <button class="touch-mini touch-start" data-surface="start" data-pressed="start" type="button" aria-label="Menu">
          <span aria-hidden="true">☰</span><small>MENU</small>
        </button>
      </div>
      <div class="touch-actions" aria-label="Action buttons">
        <button class="touch-action touch-x" data-surface="x" data-pressed="x" type="button" aria-label="X button">X</button>
        <button class="touch-action touch-y" data-surface="y" data-pressed="y" type="button" aria-label="Y button">Y</button>
        <button class="touch-action touch-a" data-surface="a" data-pressed="a" type="button" aria-label="A button">A</button>
        <button class="touch-action touch-b" data-surface="b" data-pressed="b" type="button" aria-label="B button">B</button>
      </div>
      <p class="touch-guidance" role="status">Rotate for touch controls · controller still works</p>
      <div class="touch-trails" aria-hidden="true"></div>`;
    this.root.innerHTML = this.inputProfile === "extended" ? extended : classic;
    this.root.dataset.input = this.inputProfile;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    if (this.inputProfile === "extended") this.wake();
    else this.root.classList.remove("is-awake");
  }

  setInputProfile(inputProfile) {
    if (!INPUT_PROFILES.has(inputProfile)) throw new Error(`unknown input profile '${inputProfile}'`);
    if (inputProfile === this.inputProfile) return false;
    this.clear();
    this.cancelFade();
    this.inputProfile = inputProfile;
    this.render();
    return true;
  }

  cancelFade() {
    this.fadeGeneration++;
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = 0;
  }

  wake() {
    if (this.inputProfile !== "extended") return;
    this.cancelFade();
    this.root.classList.add("is-awake");
    if (this.activePointers.size) return;
    const generation = this.fadeGeneration;
    this.fadeTimer = setTimeout(() => {
      if (generation !== this.fadeGeneration || this.activePointers.size || this.inputProfile !== "extended") return;
      this.fadeTimer = 0;
      this.root.classList.remove("is-awake");
    }, EXTENDED_FADE_MS);
  }

  hit(clientX, clientY) {
    const surfaces = [...this.root.querySelectorAll("[data-surface]")];
    for (const element of surfaces) {
      const rect = element.getBoundingClientRect();
      if (!inside(rect, clientX, clientY)) continue;
      const surface = element.dataset.surface;
      const mask = surface === "dpad"
        ? dpadMaskAt(rect, clientX, clientY)
        : Number.isInteger(TOUCH_BITS[surface]) ? 1 << TOUCH_BITS[surface] : 0;
      if (!mask) return null;
      return { surface, mask, element };
    }
    return null;
  }

  pointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const home = event.target.closest?.("[data-shell=home]");
    if (home) {
      event.preventDefault();
      if (home.getAttribute("aria-disabled") === "true") return;
      home.classList.add("is-pressed");
      this.feedback(event.clientX, event.clientY, "home");
      this.pulse();
      this.clear();
      this.onMeaningful();
      this.onHome();
      setTimeout(() => home.classList.remove("is-pressed"), 110);
      return;
    }
    const hit = this.hit(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    // Synthetic browser tests do not create a UA-active pointer and therefore
    // cannot be captured; real touch pointers still take this path.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_) {}
    this.activePointers.add(event.pointerId);
    this.state.set(event.pointerId, hit.surface, hit.mask);
    this.wake();
    this.onMeaningful();
    this.feedback(event.clientX, event.clientY, hit.surface);
    this.pulse();
  }

  pointerMove(event) {
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    const hit = this.hit(event.clientX, event.clientY);
    this.state.set(event.pointerId, hit?.surface ?? null, hit?.mask ?? 0);
    this.wake();
  }

  pointerEnd(event) {
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    this.activePointers.delete(event.pointerId);
    this.state.release(event.pointerId);
    this.wake();
    try { this.root.releasePointerCapture?.(event.pointerId); } catch (_) {}
  }

  paintPressed(pressed) {
    for (const element of this.root.querySelectorAll("[data-pressed]")) {
      element.classList.toggle("is-pressed", pressed.has(element.dataset.pressed));
    }
  }

  feedback(clientX, clientY, surface) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = this.root.getBoundingClientRect();
    const trail = document.createElement("i");
    trail.className = `touch-trail trail-${surface}`;
    trail.style.left = `${clientX - rect.left}px`;
    trail.style.top = `${clientY - rect.top}px`;
    this.root.querySelector(".touch-trails").append(trail);
    this.trails.push(trail);
    while (this.trails.length > 32) this.trails.shift().remove();
    setTimeout(() => {
      trail.remove();
      this.trails = this.trails.filter((item) => item !== trail);
    }, 420);
  }

  pulse() {
    // Very short requests are swallowed by a number of Android vibration
    // motors. This stays subtle while clearing their practical threshold.
    try { this.vibrate?.(24); } catch (_) {}
  }

  clear() {
    this.activePointers.clear();
    if (!this.state.clear()) this.onMask(0);
    this.paintPressed(new Set());
    this.wake();
  }

  destroy() {
    this.clear();
    this.cancelFade();
    this.root.removeEventListener("pointerdown", this.onPointerDown);
    this.root.removeEventListener("pointermove", this.onPointerMove);
    this.root.removeEventListener("pointerup", this.onPointerEnd);
    this.root.removeEventListener("pointercancel", this.onPointerEnd);
    this.root.removeEventListener("lostpointercapture", this.onLostCapture);
    this.root.removeEventListener("touchstart", this.onNativeTouch);
    this.root.removeEventListener("touchmove", this.onNativeTouch);
    this.root.removeEventListener("selectstart", this.onNativeInterruption);
    this.root.removeEventListener("contextmenu", this.onNativeInterruption);
    this.root.removeEventListener("dragstart", this.onNativeInterruption);
    removeEventListener("pointerup", this.onPointerEnd, true);
    removeEventListener("pointercancel", this.onPointerEnd, true);
    removeEventListener("blur", this.onPageHide);
    removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root.replaceChildren();
  }
}
