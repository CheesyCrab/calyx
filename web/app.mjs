// Calyx browser presenter: product console by default, explicit dev/test modes
// by query string. Runtime and verified framebuffer semantics remain in src/.

import { createHost, run } from "./src/runtime.mjs";
import { present } from "./src/canvas.mjs";
import { INPUT_METHOD, parseCarts, parseFeed, shellAction } from "./src/input.mjs";
import { PresenterInput } from "./src/presenter-input.mjs";
import { TouchControls } from "./src/touch-input.mjs";
import { TonePresenter } from "./src/audio.mjs";
import { LocalCartClient } from "./src/local-cart-client.mjs";
import { LOCAL_CART_LIMITS } from "./src/local-cart-profile.mjs";
import { presentationRate, shouldPresent } from "./src/presentation.mjs";
import { PerfStats, summarizePerf } from "./src/perf-stats.mjs";
import { CONFIRM_CHOICE, DESTRUCTIVE_ACTION, DestructiveConfirmation } from "./src/destructive-confirmation.mjs";
import { matchingDeployment } from "./src/deployment-metadata.mjs";

const q = new URLSearchParams(location.search);
const TEST = q.has("test");
const EXPLICIT_CART = q.has("cart");
const CONSOLE = q.has("console")
  ? (q.get("console") || "./carts/carts.json")
  : (!TEST && !EXPLICIT_CART ? "./carts/carts.json" : null);
const CART = q.get("cart") || "./demo.wasm";
const FEED = q.get("feed");
const FRAMES = parseInt(q.get("frames") || "120", 10);
const AUDIO_ENABLED = !TEST && q.get("audio") !== "off";
const DISPLAY = Object.freeze({
  classic: { w: 320, h: 240 },
  hd: { w: 1280, h: 720 },
});

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const bootReplayButton = document.getElementById("boot-replay");
const msg = document.getElementById("msg");
const homeButton = document.getElementById("home-button");
const audioButton = document.getElementById("audio-toggle");
const fullscreenButton = document.getElementById("fullscreen-button");
const helpButton = document.getElementById("help-button");
const playLocalButton = document.getElementById("play-local-button");
const localCartFile = document.getElementById("local-cart-file");
const localCartError = document.getElementById("local-cart-error");
const localCartErrorMessage = document.getElementById("local-cart-error-message");
const chooseLocalAgain = document.getElementById("choose-local-again");
const helpClose = document.getElementById("help-close");
const helpPanel = document.getElementById("help-panel");
const advancedToggle = document.getElementById("advanced-toggle");
const advancedPanel = document.getElementById("advanced-panel");
const buildNoteSection = document.getElementById("build-note-section");
const buildNote = document.getElementById("build-note");
const buildChannel = document.getElementById("build-channel");
const buildSource = document.getElementById("build-source");
const buildBuilt = document.getElementById("build-built");
const buildDeployed = document.getElementById("build-deployed");
const buildPayload = document.getElementById("build-payload");
const buildAbi = document.getElementById("build-abi");
const shareQr = document.getElementById("share-qr");
const shareLink = document.getElementById("share-link");
const copyLinkButton = document.getElementById("copy-link");
const shareLinkButton = document.getElementById("share-link-button");
const shareStatus = document.getElementById("share-status");
const updateState = document.getElementById("update-state");
const offlineState = document.getElementById("offline-state");
const releaseLabel = document.getElementById("release-label");
const touchRoot = document.getElementById("touch-controls");
const perfOverlay = document.getElementById("perf-overlay");
const perfToggle = document.getElementById("perf-toggle");
const perfFps = document.getElementById("perf-fps");
const perfSim = document.getElementById("perf-sim");
const perfDraw = document.getElementById("perf-draw");
const perfWork = document.getElementById("perf-work");
const player = document.querySelector(".player");
const confirmPanel = document.getElementById("confirm-panel");
const confirmTitle = document.getElementById("confirm-title");
const confirmDescription = document.getElementById("confirm-description");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmAccept = document.getElementById("confirm-accept");
const uploadInfoPanel = document.getElementById("upload-info-panel");
const uploadInfoCancel = document.getElementById("upload-info-cancel");
const uploadInfoContinue = document.getElementById("upload-info-continue");
const CONFIRM_TOUCH_LOCK_MS = 200;

document.body.dataset.console = CONSOLE ? "true" : "false";
document.body.dataset.display = "classic";
document.body.classList.toggle("touch-debug", q.has("touchdebug"));

// iOS emits several near-square viewport shapes while rotating. Raw CSS
// orientation queries can alternate between two complete control layouts in
// that interval, so retain the current mode through the ambiguous zone and
// commit one switch only after the new aspect is clear and stable.
let layoutMode = innerWidth > innerHeight ? "landscape" : "portrait";
let pendingLayoutMode = null;
let layoutTimer = 0;
let metricsTimer = 0;
function viewportSize() {
  return {
    width: document.documentElement.clientWidth || innerWidth,
    height: document.documentElement.clientHeight || innerHeight,
  };
}
function applyViewportMetrics() {
  const { width, height } = viewportSize();
  document.documentElement.style.setProperty("--layout-width", `${width}px`);
  document.documentElement.style.setProperty("--layout-height", `${height}px`);
}
function positionConfirmation() {
  if (confirmPanel.hidden || confirmPanel.dataset.action !== DESTRUCTIVE_ACTION.HOME) return;
  const rect = canvas.getBoundingClientRect();
  confirmPanel.style.setProperty("--confirm-screen-left", `${rect.left}px`);
  confirmPanel.style.setProperty("--confirm-screen-top", `${rect.top}px`);
  confirmPanel.style.setProperty("--confirm-screen-width", `${rect.width}px`);
  confirmPanel.style.setProperty("--confirm-screen-height", `${rect.height}px`);
}
function positionTouchDeck() {
  const screen = canvas.getBoundingClientRect();
  const field = player.getBoundingClientRect();
  touchRoot.style.setProperty("--touch-screen-left", `${screen.left}px`);
  touchRoot.style.setProperty("--touch-screen-top", `${screen.top}px`);
  touchRoot.style.setProperty("--touch-screen-width", `${screen.width}px`);
  touchRoot.style.setProperty("--touch-screen-height", `${screen.height}px`);
  touchRoot.style.setProperty("--touch-field-left", `${field.left}px`);
  touchRoot.style.setProperty("--touch-field-top", `${field.top}px`);
  touchRoot.style.setProperty("--touch-field-width", `${field.width}px`);
  touchRoot.style.setProperty("--touch-field-height", `${field.height}px`);
  touchRoot.style.setProperty("--touch-field-bottom", `${field.bottom}px`);
  perfOverlay.style.left = `${screen.left + 8}px`;
  perfOverlay.style.top = `${screen.top + 8}px`;
  perfOverlay.style.setProperty("--touch-screen-left", `${screen.left}px`);
  perfOverlay.style.setProperty("--touch-screen-top", `${screen.top}px`);
  perfOverlay.style.setProperty("--touch-screen-width", `${screen.width}px`);
  perfOverlay.style.setProperty("--touch-screen-height", `${screen.height}px`);
}
function reconcileViewportMetrics() {
  if (metricsTimer) clearTimeout(metricsTimer);
  metricsTimer = setTimeout(() => {
    metricsTimer = 0;
    applyViewportMetrics();
    positionTouchDeck();
  }, 180);
}
function classifyLayout() {
  const { width, height } = viewportSize();
  if (width > height * 1.12) return "landscape";
  if (height > width * 1.12) return "portrait";
  return layoutMode;
}
function applyLayoutMode(mode) {
  layoutMode = mode;
  document.body.classList.toggle("layout-landscape", mode === "landscape");
  document.body.dataset.layout = mode;
  applyViewportMetrics();
  requestAnimationFrame(() => {
    positionConfirmation();
    positionTouchDeck();
  });
}
function reconcileLayoutMode() {
  reconcileViewportMetrics();
  const next = classifyLayout();
  if (next === layoutMode) {
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = 0;
    pendingLayoutMode = null;
    return;
  }
  if (pendingLayoutMode === next) return;
  if (layoutTimer) clearTimeout(layoutTimer);
  pendingLayoutMode = next;
  layoutTimer = setTimeout(() => {
    layoutTimer = 0;
    if (classifyLayout() === pendingLayoutMode) applyLayoutMode(pendingLayoutMode);
    pendingLayoutMode = null;
  }, 180);
}
applyLayoutMode(layoutMode);
addEventListener("resize", reconcileLayoutMode);
addEventListener("orientationchange", reconcileLayoutMode);
globalThis.visualViewport?.addEventListener("resize", reconcileLayoutMode);

// The installed player follows the device. The manifest deliberately leaves
// orientation unconstrained; unlock as well for Android browsers carrying a
// stale orientation lock from an older installed manifest.
try { globalThis.screen?.orientation?.unlock?.(); } catch (_) {}

// A console face has no meaningful browser zoom gesture. Keep rapid action
// taps from triggering Safari's double-tap zoom while leaving the help sheet
// vertically scrollable.
player.addEventListener("dblclick", (event) => event.preventDefault());
player.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
player.addEventListener("selectstart", (event) => event.preventDefault());
player.addEventListener("contextmenu", (event) => event.preventDefault());
player.addEventListener("dragstart", (event) => event.preventDefault());

const audio = new TonePresenter({ fps: 60, enabled: AUDIO_ENABLED });
let session = null;
let swRegistration = null;
let activationRequested = false;
let releaseInfo = null;
let deploymentInfo = null;
let metadataPromise = null;
let shareReady = false;
let shareStatusTimer = 0;
let uploadExplained = false;

window.__calyxProduct = {
  mode: TEST ? "test" : (CONSOLE ? "console" : "cart"),
  atLauncher: false,
  cart: null,
  view: "boot",
  bootCount: 0,
  payloadId: null,
  channel: null,
  offlineReady: false,
  updateReady: false,
  inputMethod: INPUT_METHOD.KEYBOARD,
  inputProfile: "classic",
  touchMask: 0,
  confirmation: null,
  perfOverlay: false,
};

function renderPerfSample(sample = null, targetFps = 60) {
  const summary = sample ? summarizePerf(sample, targetFps) : null;
  perfFps.textContent = summary?.fps ?? `--.-/${targetFps}`;
  perfSim.textContent = summary?.sim ?? "--.--";
  perfDraw.textContent = summary?.draw ?? "--.--";
  perfWork.textContent = summary?.work ?? "--%";
}

function setMessage(text) { msg.textContent = text; }

function setViewState(view, cart = null) {
  const atLauncher = view === "launcher";
  const playing = view === "cart" || view === "local-cart";
  window.__calyxProduct.view = view;
  window.__calyxProduct.atLauncher = atLauncher;
  window.__calyxProduct.cart = cart;
  if (view === "boot") window.__calyxProduct.bootCount++;
  document.body.dataset.view = view;
  homeButton.hidden = !CONSOLE;
  homeButton.disabled = !playing;
  playLocalButton.hidden = !CONSOLE || !atLauncher;
  const touchHome = touchRoot.querySelector(".touch-home");
  touchHome?.setAttribute("aria-disabled", !playing || !CONSOLE ? "true" : "false");
  reportClientState();
  if (atLauncher) {
    swRegistration?.update().catch(() => {});
    requestUpdateActivation();
  }
}

function showLocalCartError(message) {
  localCartErrorMessage.textContent = message;
  localCartError.hidden = false;
}

function clearLocalCartError() {
  localCartError.hidden = true;
  localCartErrorMessage.textContent = "";
}

function showAudioState() {
  audioButton.textContent = audio.state === "on" ? "Sound ✓" : "Sound ○";
  audioButton.setAttribute("aria-label", audio.state === "on" ? "Mute sound" : "Enable sound");
  audioButton.setAttribute("aria-pressed", audio.state === "on" ? "true" : "false");
}

async function unlockAudio() {
  await audio.unlock().catch(() => false);
  showAudioState();
}

bootReplayButton.addEventListener("click", async () => {
  await unlockAudio();
  await session?.bootCeremony();
});

function standardGamepad() {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (pad?.connected && pad.mapping === "standard") return pad;
  }
  return null;
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadFeedAt() {
  if (!FEED) return () => 0;
  const feed = await (await fetch(FEED)).json();
  return parseFeed(feed);
}

class ConsoleSession {
  constructor(manifest) {
    this.manifest = {
      ...manifest,
      carts: manifest.carts.map((cart) => ({
        ...cart,
        presentation: presentationRate(cart.presentation),
      })),
    };
    this.metas = parseCarts({ carts: this.manifest.carts });
    this.input = new PresenterInput();
    this.touch = new TouchControls(touchRoot, {
      onMask: (mask) => {
        this.input.setTouchMask(mask);
        window.__calyxProduct.touchMask = this.input.touchMask;
        this.handleConfirmationTouch(this.input.touchMask);
      },
      onMeaningful: () => {
        this.setMethod(INPUT_METHOD.TOUCH);
        unlockAudio();
      },
      onHome: () => this.requestConfirmation(DESTRUCTIVE_ACTION.HOME, touchRoot.querySelector(".touch-home")),
    });
    this.input.addCleanupHook(() => this.touch.clear());
    this.host = null;
    this.localClient = null;
    this.localName = null;
    this.launcherBytes = fetchBytes(manifest.launcher);
    this.inputMethod = INPUT_METHOD.KEYBOARD;
    this.screen = "boot";
    this.swapping = false;
    this.quit = false;
    this.frameHandle = 0;
    this.last = performance.now();
    this.acc = 0;
    this.confirmation = new DestructiveConfirmation();
    this.confirmInvoker = null;
    this.confirmTouchMask = 0;
    this.confirmTouchLockedUntil = 0;
    this.pendingHd = null;
    this.presentation = 60;
    this.presentDue = true;
    this.perfEnabled = false;
    this.perf = new PerfStats(performance.now());
    this.onKeyDown = (event) => this.keyDown(event);
    this.onKeyUp = (event) => this.keyUp(event);
    this.onVisibility = () => {
      if (document.hidden) this.input.clear({ suppressGamepad: true });
    };
  }

  async boot(
    source,
    system,
    { display = "classic", input = "classic", presentation = 60, carts = this.metas } = {},
  ) {
    if (!Object.hasOwn(DISPLAY, display)) throw new Error(`unknown display profile '${display}'`);
    if (!["classic", "extended"].includes(input)) throw new Error(`unknown input profile '${input}'`);
    presentation = presentationRate(presentation);
    const wasm = typeof source === "string" ? await fetchBytes(source) : source;
    const { w, h } = DISPLAY[display];
    const host = await createHost(wasm, {
      w,
      h,
      system,
      carts,
      inputMethod: this.inputMethod,
    });
    const fault = host.start();
    if (fault) throw new Error(`start faulted: ${fault.msg}`);
    canvas.width = w;
    canvas.height = h;
    document.body.dataset.display = display;
    this.input.setInputProfile(input);
    this.touch.setInputProfile(input);
    document.body.dataset.input = input;
    window.__calyxProduct.inputProfile = input;
    this.presentation = presentation;
    this.presentDue = true;
    requestAnimationFrame(() => {
      positionConfirmation();
      positionTouchDeck();
    });
    return host;
  }

  async bootLauncher() {
    audio.reset();
    this.host = await this.boot(await this.launcherBytes, true, { display: "classic", input: "classic" });
    this.screen = "launcher";
    this.pendingHd = null;
    setViewState("launcher", "launcher");
    setMessage("launcher");
  }

  async bootCeremony() {
    if (this.swapping) return;
    if (this.screen === "local-cart") {
      this.localClient?.dispose();
      this.localClient = null;
      this.localName = null;
    }
    this.input.clear({ suppressGamepad: true });
    this.swapping = true;
    try {
      if (!this.manifest.boot || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await this.bootLauncher();
        return;
      }
      audio.reset();
      this.host = await this.boot(this.manifest.boot, true, { display: "classic", input: "classic" });
      this.screen = "boot";
      setViewState("boot", "boot");
      setMessage("boot");
    } catch (error) {
      console.warn(`boot unavailable: ${error.message}; falling back to launcher`);
      await this.bootLauncher();
    } finally {
      this.swapping = false;
    }
  }

  async bootCart(index) {
    audio.reset();
    const cart = this.manifest.carts[index];
    this.host = await this.boot(cart.wasm, !!cart.system, {
      display: cart.display ?? "classic",
      input: cart.input ?? "classic",
      presentation: cart.presentation ?? 60,
    });
    this.screen = "cart";
    this.pendingHd = null;
    setViewState("cart", cart.name);
    setMessage(cart.name);
  }

  async launchCart(index) {
    const cart = this.manifest.carts[index];
    if (!cart) throw new Error(`launch ${index} out of range`);
    if ((cart.display ?? "classic") !== "hd") return this.bootCart(index);
    const hdBoot = this.manifest["hd-boot"];
    if (!hdBoot) throw new Error(`${cart.name} requires the missing hd-boot role`);
    this.pendingHd = index;
    audio.reset();
    this.host = await this.boot(hdBoot, true, {
      display: "hd",
      input: "classic",
      carts: [this.metas[index]],
    });
    this.screen = "hd-boot";
    setViewState("boot", "hd-boot");
    setMessage("CAL/X HD");
  }

  isPlaying() { return this.screen === "cart" || this.screen === "local-cart"; }

  setPerfEnabled(enabled) {
    this.perfEnabled = !!enabled;
    this.perf.reset(performance.now());
    renderPerfSample(null, this.presentation);
    perfOverlay.hidden = !this.perfEnabled;
    document.body.classList.toggle("perf-open", this.perfEnabled);
    perfToggle.setAttribute("aria-pressed", this.perfEnabled ? "true" : "false");
    perfToggle.textContent = `Performance overlay: ${this.perfEnabled ? "On" : "Off"}`;
    window.__calyxProduct.perfOverlay = this.perfEnabled;
    if (this.perfEnabled) requestAnimationFrame(positionTouchDeck);
  }

  recordPresentation(timing) {
    if (!this.perfEnabled || !timing) return;
    const sample = this.perf.recordPresentation(timing, performance.now());
    if (sample) renderPerfSample(sample, this.presentation);
  }

  presentCurrent() {
    let timing = null;
    if (this.screen === "local-cart") {
      if (this.localClient?.fb?.px.length) {
        timing = present(ctx, this.localClient.fb, this.localClient.palette, this.perfEnabled);
      }
    } else if (this.host) {
      timing = present(ctx, this.host.fb, this.host.palette, this.perfEnabled);
    }
    this.recordPresentation(timing);
  }

  async loadLocalCart(file) {
    if (this.screen !== "launcher" || this.swapping) return;
    clearLocalCartError();
    if (file.size > LOCAL_CART_LIMITS.maximumFileBytes) {
      showLocalCartError("This cart is larger than 8 MiB.");
      return;
    }
    const sessionId = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const worker = new Worker(new URL("./src/local-cart-worker.mjs", import.meta.url), {
      type: "module",
      name: "calyx-local-cart",
    });
    const client = new LocalCartClient({
      worker,
      sessionId,
      onFrame: ({ fb, palette, rec }) => {
        if (this.localClient !== client || this.screen !== "local-cart") return;
        audio.frame(rec.f, rec.audio);
        present(ctx, fb, palette);
      },
      onFault: ({ error, phase, frame }) => this.stopLocalCart(error, phase, frame),
    });
    this.swapping = true;
    setMessage(`checking ${file.name}…`);
    try {
      const ready = await client.load(new Uint8Array(await file.arrayBuffer()));
      if (this.screen !== "launcher") {
        client.dispose();
        return;
      }
      this.input.clear({ suppressGamepad: true });
      audio.reset();
      this.localClient = client;
      this.localName = file.name;
      this.screen = "local-cart";
      this.acc = 0;
      this.last = performance.now();
      setViewState("local-cart", `Local cart · ${file.name}`);
      setMessage(`Local cart · ${file.name}`);
      audio.frame(ready.rec.f, ready.rec.audio);
      present(ctx, ready.fb, ready.palette);
    } catch (error) {
      client.dispose();
      setMessage("launcher");
      showLocalCartError(error.message);
    } finally {
      this.swapping = false;
    }
  }

  stopLocalCart(error, phase = "update", frame = null) {
    if (this.screen !== "local-cart") return;
    this.localClient = null;
    this.localName = null;
    this.input.clear({ suppressGamepad: true });
    audio.reset();
    this.screen = "launcher";
    this.acc = 0;
    this.last = performance.now();
    setViewState("launcher", "launcher");
    this.presentCurrent();
    const where = frame === null ? phase : `${phase}, frame ${frame}`;
    setMessage("local cart stopped");
    showLocalCartError(`${error.message} (${where})`);
  }

  async home() {
    if (!this.isPlaying() || this.swapping) return;
    this.input.clear({ suppressGamepad: true });
    this.swapping = true;
    try {
      if (this.screen === "local-cart") {
        this.localClient?.dispose();
        this.localClient = null;
        this.localName = null;
        audio.reset();
        this.screen = "launcher";
        setViewState("launcher", "launcher");
        setMessage("launcher");
        this.presentCurrent();
      } else {
        await this.bootLauncher();
      }
    } finally { this.swapping = false; }
  }

  requestConfirmation(action, invoker = null) {
    if (!this.isPlaying() || this.swapping || this.confirmation.action) return;
    this.input.clear({ suppressGamepad: true });
    audio.reset();
    this.acc = 0;
    this.last = performance.now();
    this.confirmInvoker = invoker instanceof HTMLElement ? invoker : document.activeElement;
    this.confirmation.open(action);
    this.confirmTouchMask = 0;
    this.confirmTouchLockedUntil = performance.now() + CONFIRM_TOUCH_LOCK_MS;
    confirmTitle.textContent = action === DESTRUCTIVE_ACTION.HOME ? "Return home?" : "Quit Calyx?";
    confirmDescription.textContent = action === DESTRUCTIVE_ACTION.HOME
      ? "Your current run will end and the launcher will open."
      : "Your current cart session will be discarded and the player will stop.";
    confirmPanel.hidden = false;
    confirmPanel.dataset.action = action;
    document.body.classList.add("confirmation-open");
    player.setAttribute("aria-hidden", "true");
    player.inert = action !== DESTRUCTIVE_ACTION.HOME;
    window.__calyxProduct.confirmation = action;
    positionConfirmation();
    confirmCancel.focus();
  }

  closeConfirmation({ restoreFocus = true } = {}) {
    this.confirmation.close();
    confirmPanel.hidden = true;
    delete confirmPanel.dataset.action;
    document.body.classList.remove("confirmation-open");
    player.removeAttribute("aria-hidden");
    player.inert = false;
    window.__calyxProduct.confirmation = null;
    this.input.clear({ suppressGamepad: true });
    this.acc = 0;
    this.last = performance.now();
    if (restoreFocus && this.confirmInvoker?.focus) this.confirmInvoker.focus();
    this.confirmInvoker = null;
    this.confirmTouchMask = 0;
    this.confirmTouchLockedUntil = 0;
  }

  cancelConfirmation() {
    if (!this.confirmation.action) return;
    this.closeConfirmation();
  }

  acceptConfirmation() {
    const action = this.confirmation.acceptedAction();
    if (!action) return this.cancelConfirmation();
    this.closeConfirmation({ restoreFocus: false });
    if (action === DESTRUCTIVE_ACTION.HOME) {
      this.home();
    } else {
      audio.reset();
      this.localClient?.dispose();
      this.localClient = null;
      this.localName = null;
      this.quit = true;
      setMessage("quit — reload to restart");
    }
  }

  selectConfirmation(choice) {
    if (!this.confirmation.action) return;
    this.confirmation.choice = choice;
    (choice === CONFIRM_CHOICE.CANCEL ? confirmCancel : confirmAccept).focus();
  }

  handleConfirmationTouch(mask) {
    const pressed = mask & ~this.confirmTouchMask;
    this.confirmTouchMask = mask;
    if (!this.confirmation.action || performance.now() < this.confirmTouchLockedUntil) return;

    const cancelDirection = (1 << 0) | (1 << 2);
    const confirmDirection = (1 << 1) | (1 << 3);
    if (pressed & cancelDirection) this.selectConfirmation(CONFIRM_CHOICE.CANCEL);
    if (pressed & confirmDirection) this.selectConfirmation(CONFIRM_CHOICE.CONFIRM);
    if (pressed & (1 << 5)) this.cancelConfirmation();
    else if (pressed & (1 << 4)) this.acceptConfirmation();
  }

  setMethod(method) {
    if (method == null) return;
    this.touch.wake();
    this.inputMethod = method;
    window.__calyxProduct.inputMethod = method;
    this.host?.setInputMethod(method);
  }

  keyDown(event) {
    if (this.confirmation.action) {
      if (event.code === "Escape" || event.code === "KeyX") this.cancelConfirmation();
      else if (event.code === "ArrowLeft") this.selectConfirmation(CONFIRM_CHOICE.CANCEL);
      else if (event.code === "ArrowRight") this.selectConfirmation(CONFIRM_CHOICE.CONFIRM);
      else if (event.code === "Tab") {
        this.confirmation.toggle();
        this.selectConfirmation(this.confirmation.choice);
      }
      else if (event.code === "KeyZ" || event.code === "Enter") {
        if (document.activeElement === confirmAccept) this.acceptConfirmation();
        else this.cancelConfirmation();
      }
      event.preventDefault();
      return;
    }
    const shell = shellAction(event.code, this.screen === "launcher");
    if (shell === "quit") {
      if (this.isPlaying()) this.requestConfirmation(DESTRUCTIVE_ACTION.QUIT);
      else {
        this.input.clear({ suppressGamepad: true });
        audio.reset();
        this.quit = true;
        setMessage("quit — reload to restart");
      }
      event.preventDefault();
      return;
    }
    if (shell === "home") {
      this.setMethod(INPUT_METHOD.KEYBOARD);
      this.requestConfirmation(DESTRUCTIVE_ACTION.HOME);
      event.preventDefault();
      return;
    }
    const accepted = this.input.keyDown(event.code);
    if (accepted.accepted) {
      this.setMethod(accepted.method);
      unlockAudio();
      event.preventDefault();
    }
  }

  keyUp(event) {
    if (this.input.keyUp(event.code)) event.preventDefault();
  }

  async start() {
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    document.addEventListener("visibilitychange", this.onVisibility);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.manifest.boot && !reducedMotion) await this.bootCeremony();
    else await this.bootLauncher();
    this.frameHandle = requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    if (this.quit) return;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    const pad = this.input.pollGamepad(standardGamepad());
    if (pad.meaningful) {
      this.setMethod(pad.method);
      unlockAudio();
    }
    if (this.confirmation.action) {
      if (pad.pressedMask & ((1 << 2) | (1 << 3))) {
        this.confirmation.toggle();
        this.selectConfirmation(this.confirmation.choice);
      }
      if (pad.pressedMask & (1 << 4)) this.acceptConfirmation();
      if (pad.pressedMask & (1 << 5)) this.cancelConfirmation();
      this.acc = 0;
      this.last = now;
      this.presentCurrent();
      this.frameHandle = requestAnimationFrame((next) => this.frame(next));
      return;
    }
    if (pad.guidePressed) {
      if (this.isPlaying()) this.requestConfirmation(DESTRUCTIVE_ACTION.QUIT);
      else {
        this.input.clear({ suppressGamepad: true });
        audio.reset();
        this.quit = true;
        setMessage("quit — reload to restart");
        return;
      }
    }
    if (pad.backPressed && this.isPlaying()) this.requestConfirmation(DESTRUCTIVE_ACTION.HOME);

    if (this.confirmation.action) {
      this.acc = 0;
      this.last = now;
      this.presentCurrent();
      this.frameHandle = requestAnimationFrame((next) => this.frame(next));
      return;
    }

    if (!this.swapping && this.screen === "local-cart") {
      const mask = this.input.heldMask();
      // A worker may be slow without crossing its watchdog. Never bank that
      // wall-clock delay into a burst of catch-up updates when it responds.
      this.acc = Math.min(this.acc, 1000 / 60);
      if (this.acc >= 1000 / 60 && this.localClient?.step(mask, this.inputMethod)) {
        this.acc -= 1000 / 60;
      }
    } else if (!this.swapping) {
      const mask = this.input.heldMask();
      while (this.acc >= 1000 / 60) {
        const simStarted = this.perfEnabled ? performance.now() : 0;
        const { rec, fault } = this.host.stepLive(mask);
        if (this.perfEnabled) this.perf.recordSim(performance.now() - simStarted);
        if (fault) {
          const hdFailure = this.screen === "hd-boot" ||
            (this.screen === "cart" && document.body.dataset.display === "hd");
          if (this.screen === "boot" || hdFailure) {
            const failedRole = this.screen === "cart" ? "HD cart" : "boot";
            console.warn(`${failedRole} faulted at f${fault.f}: ${fault.msg}; falling back to launcher`);
            this.input.clear({ suppressGamepad: true });
            this.swapping = true;
            this.bootLauncher()
              .then(() => {
                if (hdFailure) setMessage(`HD failed at f${fault.f}: ${fault.msg}`);
              })
              .catch((error) => {
                this.quit = true;
                setMessage(`launcher failed: ${error.message}`);
              })
              .finally(() => { this.swapping = false; });
            break;
          }
          setMessage(`faulted at f${fault.f}: ${fault.msg}`);
          return;
        }
        audio.frame(rec.f, rec.audio);
        this.presentDue ||= shouldPresent(rec.f + 1, this.presentation);
        this.acc -= 1000 / 60;
        const event = rec.sys[0];
        if (event) {
          this.input.clear({ suppressGamepad: true });
          this.swapping = true;
          let swap;
          if (event.op === "launch" && this.screen === "hd-boot") {
            swap = event.i === 0 && this.pendingHd != null
              ? this.bootCart(this.pendingHd)
              : Promise.reject(new Error(`invalid hd-boot launch ${event.i}`));
          } else if (event.op === "launch") {
            swap = this.launchCart(event.i);
          } else {
            swap = this.bootLauncher();
          }
          swap.catch(async (error) => {
            console.error(`console transition failed: ${error.message}`);
            await this.bootLauncher();
            setMessage(`HD launch failed: ${error.message}`);
          }).finally(() => { this.swapping = false; });
          break;
        }
      }
      if (this.presentDue) {
        this.presentCurrent();
        this.presentDue = false;
      }
    }
    this.frameHandle = requestAnimationFrame((next) => this.frame(next));
  }
}

async function singleCartMode() {
  const host = await createHost(await fetchBytes(CART));
  const fault = host.start();
  if (fault) throw new Error(`start faulted: ${fault.msg}`);
  const input = new PresenterInput();
  const touch = new TouchControls(touchRoot, {
    onMask: (mask) => {
      input.setTouchMask(mask);
      window.__calyxProduct.touchMask = mask;
    },
    onMeaningful: () => {
      host.setInputMethod(INPUT_METHOD.TOUCH);
      window.__calyxProduct.inputMethod = INPUT_METHOD.TOUCH;
      unlockAudio();
    },
  });
  input.addCleanupHook(() => touch.clear());
  let quit = false;
  let last = performance.now();
  let acc = 0;
  setViewState("cart", CART);
  setMessage(CART);
  addEventListener("keydown", (event) => {
    if (shellAction(event.code, true) === "quit") {
      input.clear({ suppressGamepad: true });
      audio.reset();
      quit = true;
      event.preventDefault();
      return;
    }
    const accepted = input.keyDown(event.code);
    if (accepted.accepted) {
      host.setInputMethod(accepted.method);
      unlockAudio();
      event.preventDefault();
    }
  });
  addEventListener("keyup", (event) => {
    if (input.keyUp(event.code)) event.preventDefault();
  });
  const frame = (now) => {
    if (quit) return;
    acc += Math.min(now - last, 250);
    last = now;
    const pad = input.pollGamepad(standardGamepad());
    if (pad.meaningful) { host.setInputMethod(pad.method); unlockAudio(); }
    if (pad.guidePressed) { quit = true; audio.reset(); return; }
    while (acc >= 1000 / 60) {
      const { rec, fault: stepFault } = host.stepLive(input.heldMask());
      if (stepFault) { setMessage(`faulted at f${stepFault.f}: ${stepFault.msg}`); return; }
      audio.frame(rec.f, rec.audio);
      acc -= 1000 / 60;
    }
    present(ctx, host.fb, host.palette);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function testMode() {
  const wasm = await fetchBytes(CART);
  const at = await loadFeedAt();
  let finalHost = null;
  const report = await run(wasm, {
    frames: FRAMES,
    at,
    onFrame: (host) => {
      finalHost = host;
      present(ctx, host.fb, host.palette);
    },
  }, "browser");
  if (finalHost) present(ctx, finalHost.fb, finalHost.palette);
  window.__calyx = {
    run_hash: report.run_hash,
    final_hash: report.final_hash,
    palette_id: report.palette_id,
    ...(report.color ? { color: report.color } : {}),
    frames: report.frames_run,
    fault: report.fault,
  };
  setMessage(`test: run_hash ${report.run_hash}`);
}

function reportClientState() {
  const message = {
    type: "CLIENT_STATE",
    atLauncher: window.__calyxProduct.atLauncher,
    payloadId: window.__calyxProduct.payloadId,
  };
  navigator.serviceWorker?.controller?.postMessage(message);
  swRegistration?.waiting?.postMessage(message);
}

function markUpdateReady() {
  window.__calyxProduct.updateReady = true;
  updateState.hidden = false;
  setTimeout(() => {
    reportClientState();
    requestUpdateActivation();
  }, 0);
}

function requestUpdateActivation() {
  if (!window.__calyxProduct.updateReady ||
      !window.__calyxProduct.atLauncher || !swRegistration?.waiting) return;
  activationRequested = true;
  reportClientState();
  swRegistration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
}

function formatTimestamp(value) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function renderBuildInfo() {
  if (!releaseInfo) return;
  const channel = releaseInfo.channel === "sideb" ? "Calyx Side B" : "Calyx RC";
  const revision = releaseInfo.source_revision || "unknown";
  let source = revision === "unknown" ? revision : revision.slice(0, 12);
  if (releaseInfo.source_local) source += " + LOCAL";
  if (releaseInfo.source_fingerprint) source += ` · ${releaseInfo.source_fingerprint}`;
  buildChannel.textContent = channel;
  buildSource.textContent = source;
  buildBuilt.textContent = formatTimestamp(releaseInfo.built_at);
  buildDeployed.textContent = formatTimestamp(deploymentInfo?.deployed_at);
  buildPayload.textContent = releaseInfo.payload_id;
  buildAbi.textContent = releaseInfo.abi;
  const note = deploymentInfo?.note?.trim();
  buildNoteSection.hidden = !note;
  buildNote.textContent = note || "";
}

async function loadProductMetadata() {
  if (metadataPromise) return metadataPromise;
  metadataPromise = (async () => {
    try {
      const response = await fetch("./release.json", { cache: "no-store" });
      if (!response.ok) return;
      releaseInfo = await response.json();
    } catch (_) {
      return;
    }
    let networkDeployment = null;
    try {
      const response = await fetch("./deployment.json", { cache: "no-store" });
      if (response.ok) {
        networkDeployment = await response.json();
      }
    } catch (_) {}
    let cachedDeployment = null;
    try {
      cachedDeployment = JSON.parse(localStorage.getItem("calyx-deployment"));
    } catch (_) {}
    deploymentInfo = matchingDeployment(
      releaseInfo,
      networkDeployment,
      cachedDeployment,
    );
    if (deploymentInfo === networkDeployment) {
      localStorage.setItem("calyx-deployment", JSON.stringify(deploymentInfo));
    }
    window.__calyxProduct.payloadId = releaseInfo.payload_id;
    window.__calyxProduct.channel = releaseInfo.channel || "stable";
    const channelLabel = releaseInfo.channel === "sideb" ? "SIDE B" : "RC";
    releaseLabel.textContent = `${channelLabel} ${releaseInfo.payload_id.slice(0, 8)} · ABI ${releaseInfo.abi}`;
    renderBuildInfo();
  })();
  return metadataPromise;
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || TEST) return;
  await loadProductMetadata();
  if (!releaseInfo) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "PRECACHE_READY") {
      window.__calyxProduct.offlineReady = true;
      offlineState.hidden = false;
    } else if (data.type === "UPDATE_READY") {
      markUpdateReady();
    } else if (data.type === "UPDATE_BLOCKED") {
      setMessage("update waiting for all Calyx windows to return home");
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (activationRequested) location.reload();
  });

  swRegistration = await navigator.serviceWorker.register("./sw.js", {
    updateViaCache: "none",
  });
  if (swRegistration.waiting) markUpdateReady();
  swRegistration.addEventListener("updatefound", () => {
    const worker = swRegistration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        markUpdateReady();
      }
    });
  });
  await navigator.serviceWorker.ready;
  navigator.serviceWorker.controller?.postMessage({ type: "GET_STATUS" });
  reportClientState();
  await swRegistration.update().catch(() => {});
}

audioButton.addEventListener("click", async () => {
  await audio.setMuted(audio.state === "on");
  showAudioState();
});

homeButton.addEventListener("click", () => session?.requestConfirmation(DESTRUCTIVE_ACTION.HOME, homeButton));
function setUploadInfo(open) {
  uploadInfoPanel.hidden = !open;
  document.body.classList.toggle("upload-info-open", open);
  player.setAttribute("aria-hidden", open ? "true" : "false");
  player.inert = open;
  if (open) uploadInfoCancel.focus();
  else playLocalButton.focus();
}

playLocalButton.addEventListener("click", () => {
  if (uploadExplained) localCartFile.click();
  else setUploadInfo(true);
});
uploadInfoCancel.addEventListener("click", () => setUploadInfo(false));
uploadInfoContinue.addEventListener("click", () => {
  uploadExplained = true;
  setUploadInfo(false);
  localCartFile.click();
});
addEventListener("keydown", (event) => {
  if (uploadInfoPanel.hidden) return;
  if (event.code === "Escape") setUploadInfo(false);
  else if (event.code === "Tab") {
    const next = document.activeElement === uploadInfoCancel ? uploadInfoContinue : uploadInfoCancel;
    next.focus();
  } else return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
chooseLocalAgain.addEventListener("click", () => localCartFile.click());
localCartFile.addEventListener("change", () => {
  const file = localCartFile.files?.[0] ?? null;
  // Browsers otherwise suppress a second change event for a rebuilt file with
  // the same path and name.
  localCartFile.value = "";
  if (!file) return;
  setHelp(false);
  session?.loadLocalCart(file);
});
confirmCancel.addEventListener("click", () => session?.cancelConfirmation());
confirmAccept.addEventListener("click", () => {
  session?.selectConfirmation(CONFIRM_CHOICE.CONFIRM);
  session?.acceptConfirmation();
});

fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
});
if (!document.documentElement.requestFullscreen || matchMedia("(display-mode: standalone)").matches) {
  fullscreenButton.hidden = true;
}

function playerShareUrl() {
  return new URL("./", location.href).href;
}

function setShareStatus(text) {
  shareStatus.textContent = text;
  if (shareStatusTimer) clearTimeout(shareStatusTimer);
  shareStatusTimer = text ? setTimeout(() => { shareStatus.textContent = ""; }, 2400) : 0;
}

function setupShare() {
  if (shareReady) return;
  shareReady = true;
  const url = playerShareUrl();
  shareLink.href = url;
  shareLink.textContent = url.replace(/^https?:\/\//, "");
  shareLinkButton.hidden = typeof navigator.share !== "function";
  if (typeof globalThis.qrcode !== "function") {
    shareQr.textContent = "QR unavailable";
    return;
  }
  const code = globalThis.qrcode(0, "M");
  code.addData(url, "Byte");
  code.make();
  shareQr.innerHTML = code.createSvgTag({
    cellSize: 5,
    margin: 20,
    scalable: true,
    title: "Scan to open Calyx",
    alt: `QR code for ${url}`,
  });
}

function setHelp(open) {
  if (open) setupShare();
  helpPanel.hidden = !open;
  helpButton.setAttribute("aria-expanded", open ? "true" : "false");
}
helpButton.addEventListener("click", () => setHelp(helpPanel.hidden));
helpClose.addEventListener("click", () => setHelp(false));
advancedToggle.addEventListener("click", () => {
  const open = advancedPanel.hidden;
  advancedPanel.hidden = !open;
  advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
});
perfToggle.addEventListener("click", () => session?.setPerfEnabled(!session.perfEnabled));
copyLinkButton.addEventListener("click", async () => {
  try {
    if (typeof navigator.clipboard?.writeText !== "function") throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(playerShareUrl());
    setShareStatus("Link copied ✓");
  } catch (_) {
    setShareStatus("Long-press the link to copy");
  }
});
shareLinkButton.addEventListener("click", async () => {
  try {
    await navigator.share({ title: "Calyx", text: "Play Calyx", url: playerShareUrl() });
    setShareStatus("Shared ✓");
  } catch (error) {
    if (error?.name !== "AbortError") setShareStatus("Share unavailable");
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) swRegistration?.update().catch(() => {});
});

showAudioState();

async function main() {
  loadProductMetadata().catch(() => {});
  setupServiceWorker().catch((error) => setMessage(`PWA setup: ${error.message}`));
  if (TEST) return testMode();
  if (CONSOLE) {
    const manifest = await (await fetch(CONSOLE)).json();
    session = new ConsoleSession(manifest);
    return session.start();
  }
  return singleCartMode();
}

main().catch((error) => {
  setMessage(`ERROR: ${error.message}`);
  window.__calyx = { error: error.message };
});
