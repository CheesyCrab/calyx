import { LOCAL_CART_LIMITS, inspectLocalCart } from "./local-cart-profile.mjs";
import { createHost } from "./runtime.mjs";

let sessionId = null;
let host = null;
let phase = "idle";

function send(type, fields = {}, transfers = []) {
  postMessage({ sessionId, type, ...fields }, transfers);
}

function enter(next) {
  phase = next;
  send("phase", { phase });
}

function snapshot(buffer = null) {
  const bytes = host.fb.px.byteLength;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== bytes) {
    buffer = new ArrayBuffer(bytes);
  }
  new Uint8Array(buffer).set(host.fb.px);
  return buffer;
}

function fault(error, frame = null) {
  const raw = String(error?.message || error || "Local cart faulted.");
  send("fault", { phase, frame, message: raw.slice(0, 500) });
}

async function loadCart(message) {
  sessionId = message.sessionId;
  try {
    const bytes = new Uint8Array(message.bytes);
    if (bytes.byteLength > LOCAL_CART_LIMITS.maximumFileBytes) {
      throw new Error("This cart is larger than 8 MiB.");
    }
    enter("compile");
    const module = await WebAssembly.compile(bytes);
    inspectLocalCart(bytes);
    enter("instantiate");
    host = await createHost(module, { limits: LOCAL_CART_LIMITS });
    enter("start");
    const startFault = host.start();
    if (startFault) throw new Error(`start faulted: ${startFault.msg}`);
    enter("first-frame");
    const result = host.stepLive(0);
    if (result.fault) throw new Error(`frame 0 faulted: ${result.fault.msg}`);
    const frame = snapshot();
    phase = "ready";
    send("ready", {
      colorMode: host.fb.colorMode,
      width: host.width,
      height: host.height,
      palette: host.palette.entries.map((entry) => entry.slice()),
      rec: result.rec,
      frame,
    }, [frame]);
  } catch (error) {
    fault(error, host?.frame ?? null);
    host = null;
  }
}

function stepCart(message) {
  if (!host || message.sessionId !== sessionId) return;
  phase = "update";
  try {
    host.setInputMethod(message.inputMethod);
    const result = host.stepLive(message.mask);
    if (result.fault) throw new Error(`frame ${result.fault.f} faulted: ${result.fault.msg}`);
    const frame = snapshot(message.frame);
    phase = "ready";
    send("frame", { rec: result.rec, frame }, [frame]);
  } catch (error) {
    fault(error, host.frame);
    host = null;
  }
}

addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type === "load") loadCart(message);
  else if (message.type === "step") stepCart(message);
});
