const DEFAULT_TIMEOUTS = Object.freeze({
  compile: 10_000,
  instantiate: 2_000,
  start: 2_000,
  "first-frame": 500,
  update: 500,
});

function paletteView(entries) {
  return { rgb: (index) => entries[index] ?? [0, 0, 0] };
}

export class LocalCartClient {
  constructor({ worker, sessionId, timeouts = {}, onFrame = null, onFault = null }) {
    this.worker = worker;
    this.sessionId = sessionId;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
    this.onFrame = onFrame;
    this.onFault = onFault;
    this.phase = "idle";
    this.fb = null;
    this.palette = null;
    this.pendingStep = false;
    this.disposed = false;
    this.timer = 0;
    this.loadResolve = null;
    this.loadReject = null;
    worker.addEventListener("message", (event) => this.handleMessage(event.data));
    worker.addEventListener("error", (event) => {
      this.fail(new Error(event.message || "Local cart worker failed."));
    });
    worker.addEventListener("messageerror", () => {
      this.fail(new Error("Local cart worker sent an unreadable message."));
    });
  }

  load(input) {
    if (this.phase !== "idle") return Promise.reject(new Error("Local cart load already started."));
    const source = input instanceof Uint8Array ? input : new Uint8Array(input);
    const bytes = source.slice();
    this.phase = "compile";
    this.armWatchdog("compile");
    const promise = new Promise((resolve, reject) => {
      this.loadResolve = resolve;
      this.loadReject = reject;
    });
    this.worker.postMessage(
      { sessionId: this.sessionId, type: "load", bytes: bytes.buffer },
      [bytes.buffer],
    );
    return promise;
  }

  step(mask, inputMethod) {
    if (this.disposed || this.phase !== "ready" || this.pendingStep || !this.fb) return false;
    const frame = this.fb.px.buffer;
    this.fb.px = new Uint8Array(0);
    this.pendingStep = true;
    this.armWatchdog("update");
    this.worker.postMessage(
      { sessionId: this.sessionId, type: "step", mask, inputMethod, frame },
      [frame],
    );
    return true;
  }

  handleMessage(message) {
    if (this.disposed || message?.sessionId !== this.sessionId) return;
    if (message.type === "phase") {
      this.phase = message.phase;
      this.armWatchdog(message.phase);
      return;
    }
    if (message.type === "ready") {
      this.clearWatchdog();
      this.phase = "ready";
      this.fb = { colorMode: message.colorMode ?? 0, w: message.width, h: message.height, px: new Uint8Array(message.frame) };
      this.palette = paletteView(message.palette);
      const resolve = this.loadResolve;
      this.loadResolve = null;
      this.loadReject = null;
      resolve?.({ fb: this.fb, palette: this.palette, rec: message.rec });
      return;
    }
    if (message.type === "frame") {
      this.clearWatchdog();
      this.phase = "ready";
      this.pendingStep = false;
      this.fb.px = new Uint8Array(message.frame);
      this.onFrame?.({ fb: this.fb, palette: this.palette, rec: message.rec });
      return;
    }
    if (message.type === "fault") {
      this.fail(new Error(message.message || "Local cart faulted."), message.phase, message.frame);
    }
  }

  armWatchdog(phase) {
    this.clearWatchdog();
    const delay = this.timeouts[phase];
    if (!delay) return;
    this.timer = setTimeout(() => {
      this.fail(new Error(`${phase} timed out after ${delay} ms.`), phase);
    }, delay);
  }

  clearWatchdog() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
  }

  fail(error, phase = this.phase, frame = null) {
    if (this.disposed) return;
    const reject = this.loadReject;
    this.loadResolve = null;
    this.loadReject = null;
    this.clearWatchdog();
    this.disposed = true;
    this.worker.terminate();
    if (reject) reject(error);
    else this.onFault?.({ error, phase, frame });
  }

  dispose() {
    if (this.disposed) return;
    const reject = this.loadReject;
    this.loadResolve = null;
    this.loadReject = null;
    this.clearWatchdog();
    this.disposed = true;
    this.worker.terminate();
    reject?.(new Error("Local cart session ended."));
  }
}
