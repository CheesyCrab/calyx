// The Calyx web runtime — the ABI v1.6 host in JS, a peer of the native
// core (ABI §4, §4b, §6a). DOM-free on purpose: this same module runs under
// Node (the cross-runtime parity gate) and, behind the T7 canvas/PWA shell,
// in the browser. It shares no code with the Rust runtime — only the ABI.
// Everything that touches the framebuffer (clip, the m6x11 font, FNV-1a)
// must match core byte-for-byte, which the conformance suite enforces.

import { fnvWrite, FNV_OFFSET, hex16, le8 } from "./fnv.mjs";
import { Framebuffer } from "./framebuffer.mjs";
import { Palette } from "./palette.mjs";
import { Font, drawText } from "./font.mjs";
import { names } from "./input.mjs";

const FONT = new Font(); // the pinned m6x11, loaded once
const utf8 = new TextDecoder();

// A run that ended in a trap/abort never matches a golden; msg is
// informational and never compared (ABI §6a).
class Trap extends Error {}

export function createResourceMeter(limits) {
  let traceBytes = 0;
  let toneEvents = 0;
  let toneDurationFrames = 0;
  let noiseDurationFrames = 0;
  return {
    reset() {
      traceBytes = 0;
      toneEvents = 0;
      toneDurationFrames = 0;
      noiseDurationFrames = 0;
    },
    trace(length) {
      if (length > limits.maximumTraceBytes) {
        throw new Trap(`trace message exceeds ${limits.maximumTraceBytes} bytes`);
      }
      traceBytes += length;
      if (traceBytes > limits.maximumTraceBytesPerFrame) {
        throw new Trap(`trace output exceeds ${limits.maximumTraceBytesPerFrame} bytes this frame`);
      }
    },
    tone(duration, flags = 0) {
      toneEvents++;
      if (toneEvents > limits.maximumToneEventsPerFrame) {
        throw new Trap(`tone events exceed ${limits.maximumToneEventsPerFrame} this frame`);
      }
      if (duration > limits.maximumToneDurationFrames) {
        throw new Trap(`tone duration exceeds ${limits.maximumToneDurationFrames} frames`);
      }
      if ((flags & 3) === 3 && duration > limits.maximumNoiseDurationFrames) {
        throw new Trap(`noise duration exceeds ${limits.maximumNoiseDurationFrames} frames`);
      }
      if ((flags & 3) === 3) {
        noiseDurationFrames += Math.max(0, duration);
        if (noiseDurationFrames > limits.maximumNoiseDurationFramesPerFrame) {
          throw new Trap(
            `combined noise duration exceeds ${limits.maximumNoiseDurationFramesPerFrame} frames this frame`,
          );
        }
      }
      toneDurationFrames += Math.max(0, duration);
      if (toneDurationFrames > limits.maximumToneDurationFramesPerFrame) {
        throw new Trap(
          `combined tone duration exceeds ${limits.maximumToneDurationFramesPerFrame} frames this frame`,
        );
      }
    },
    memory(byteLength) {
      if (byteLength > limits.maximumMemoryPages * 65536) {
        throw new Trap(`cart memory limit exceeded (${byteLength} bytes)`);
      }
    },
  };
}

/** The §4b info record: (name, author, version, category) × len + UTF-8. */
export function encodeCartInfo(cart) {
  const enc = new TextEncoder();
  const fields = [cart.name, cart.author, cart.version, cart.category ?? "Games"]
    .map((s) => enc.encode(s ?? ""));
  const out = new Uint8Array(fields.reduce((n, b) => n + 2 + b.length, 0));
  let pos = 0;
  for (const b of fields) {
    out[pos] = b.length & 0xff;
    out[pos + 1] = (b.length >> 8) & 0xff;
    out.set(b, pos + 2);
    pos += 2 + b.length;
  }
  return out;
}

/** The pinned placeholder icon: 4096 bytes of (i % 15) + 1 (ABI §6a). */
export function placeholderIcon(i) {
  return new Uint8Array(4096).fill((i % 15) + 1);
}

function validateSysCarts(carts) {
  const enc = new TextEncoder();
  for (const cart of carts) {
    for (const [label, value, cap] of [
      ["name", cart.name ?? "", 63],
      ["author", cart.author ?? "", 63],
      ["version", cart.version ?? "", 63],
      ["category", cart.category ?? "Games", 31],
    ]) {
      if (enc.encode(String(value)).length > cap) {
        throw new Error(`cart ${label} '${value}' exceeds the ${cap}-byte ABI cap`);
      }
    }
    if (cart.icon != null && (!(cart.icon instanceof Uint8Array) || cart.icon.length !== 4096)) {
      const length = cart.icon?.length ?? "non-byte";
      throw new Error(`cart '${cart.name ?? ""}' icon must be exactly 4096 bytes, got ${length}`);
    }
  }
}

/**
 * Instantiate a cart and return a stepping host — the console as a live
 * object. `step()` advances one frame; `fb`/`palette` expose the verified
 * state to a presenter (the canvas shell drives this; `run` below drives it
 * headless). Sharing one host keeps play and verification on the same code.
 *
 * With `cfg.system` the host links `calyx.sys` (ABI §4b) — the runtime's
 * deliberate choice, which is the whole privilege model — serving
 * `cfg.carts` (see `parseCarts`); a normal cart importing `calyx.sys`
 * fails right here at instantiation because the module isn't in the
 * import object.
 *
 * @param {Uint8Array} wasmBytes
 * @param {{w?:number, h?:number, system?:boolean, carts?:Array}} [cfg]
 */
export async function createHost(wasmBytes, cfg = {}) {
  const w = cfg.w ?? 320;
  const h = cfg.h ?? 240;
  const palette = new Palette();
  const fb = new Framebuffer(w, h, palette);
  const state = {
    frame: 0,
    btn: 0,
    inputMethod: cfg.inputMethod ?? 0,
    inStart: false,
    colorSelected: false,
    traces: [],
    audio: [],
    sys: [],
    abortMsg: null,
  };
  const sysCarts = cfg.system ? (cfg.carts ?? []) : [];
  const resourceMeter = cfg.limits ? createResourceMeter(cfg.limits) : null;
  if (cfg.system) validateSysCarts(sysCarts);
  let mem = null;

  const readBytes = (ptr, len) => {
    if (!Number.isSafeInteger(len) || ptr < 0 || len < 0 || !mem || ptr + len > mem.buffer.byteLength) {
      throw new Trap(`memory read ${ptr}..${ptr + len} out of bounds (len ${mem?.buffer.byteLength ?? 0})`);
    }
    return new Uint8Array(mem.buffer, ptr, len);
  };

  const writeBytes = (ptr, bytes) => {
    if (ptr < 0 || ptr + bytes.length > mem.buffer.byteLength) {
      throw new Trap(`memory write ${ptr}..${ptr + bytes.length} out of bounds (len ${mem?.buffer.byteLength ?? 0})`);
    }
    new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
  };

  const requireRgba = () => {
    if (fb.colorMode !== 1) throw new Trap("RGBA draw requires true color");
  };

  const imports = {
    calyx: {
      frame: () => state.frame,
      width: () => w,
      height: () => h,
      btn: () => state.btn,
      cls: (idx) => fb.cls(idx),
      pixel: (x, y, idx) => fb.set(x, y, idx),
      rect: (x, y, rw, rh, idx) => fb.rect(x, y, rw, rh, idx),
      hline: (x, y, rw, idx) => fb.hline(x, y, rw, idx),
      vline: (x, y, rh, idx) => fb.vline(x, y, rh, idx),
      text: (x, y, ptr, len, idx, scale) => drawText(fb, FONT, x, y, readBytes(ptr, len), idx, scale),
      blit: (ptr, sw, sh, x, y, dw, dh, flags) => {
        if (sw < 0 || sh < 0) throw new Trap(`blit negative source size (${sw}x${sh})`);
        if (sw * sh > 2147483647) throw new Trap("sprite byte span exceeds signed i32");
        fb.blit(readBytes(ptr, sw * sh), sw, sh, x, y, dw, dh, flags);
      },
      set_color_mode: (mode) => {
        if (!state.inStart) throw new Trap("set_color_mode called outside start()");
        if (state.colorSelected) throw new Trap("set_color_mode called more than once");
        if (mode !== 0 && mode !== 1) throw new Trap("invalid color mode");
        state.colorSelected = true;
        fb.setColorMode(mode);
      },
      rgba_cls: (rgba) => { requireRgba(); fb.rgbaCls(rgba); },
      rgba_rect: (x,y,rw,rh,rgba) => { requireRgba(); fb.rgbaRect(x,y,rw,rh,rgba); },
      rgba_text: (x,y,ptr,len,rgba,scale) => {
        requireRgba();
        drawText({ rect: (a,b,c,d,color) => fb.rgbaRect(a,b,c,d,color) },
          FONT,x,y,readBytes(ptr,len),rgba,scale);
      },
      clip: (x,y,rw,rh) => fb.clip(x,y,rw,rh),
      clip_reset: () => fb.clipReset(),
      blit_region: (ptr,sw,sh,sx,sy,rw,rh,x,y,dw,dh,flags,tint,opacity) => {
        if ((flags & ~15) !== 0 || ((flags & 8) && (flags & 4))) throw new Trap("invalid blit_region flags");
        if ((tint >>> 24) !== 0 || opacity < 0 || opacity > 255) throw new Trap("invalid tint or opacity");
        if (sw < 0 || sh < 0 || sx < 0 || sy < 0 || rw < 0 || rh < 0 || sx+rw > sw || sy+rh > sh) {
          throw new Trap("invalid blit_region source rectangle");
        }
        if (fb.colorMode === 0 && ((flags & 8) || tint !== 0xffffff || opacity !== 255)) {
          throw new Trap("blit_region effect requires true color");
        }
        const byteLength = sw*sh*((flags&8)?4:1);
        if (!Number.isSafeInteger(byteLength) || byteLength > 2147483647) throw new Trap("sprite byte span exceeds signed i32");
        const source = readBytes(ptr, byteLength);
        fb.blitRegion(source,sw,sh,sx,sy,rw,rh,x,y,dw,dh,flags,tint,opacity);
      },
      set_palette: (ptr, count) => {
        if (!state.inStart) throw new Trap("set_palette called outside start()");
        if (count < 0 || count > 256) throw new Trap(`set_palette count ${count} out of range`);
        palette.setFromRgb(readBytes(ptr, count * 3), count);
      },
      tone: (freq, dur, vol, flags) => {
        if ((flags & ~15) !== 0) throw new Trap(`tone reserved flag bits set: ${flags}`);
        resourceMeter?.tone(dur, flags);
        state.audio.push({ op: "tone", freq, dur, vol, flags });
      },
      trace: (ptr, len) => {
        resourceMeter?.trace(len);
        state.traces.push(utf8.decode(readBytes(ptr, len)));
      },
    },
    env: {
      // AssemblyScript calls env.abort on a failed assertion; surface it as a
      // fault (ABI §6a) instead of the proto's silent no-op.
      abort: (_msg, _file, line, col) => {
        state.abortMsg = `AS abort at ${line}:${col}`;
        throw new Trap("abort");
      },
    },
  };

  // The privileged module (ABI §4b) — present ONLY for system runs.
  if (cfg.system) {
    imports["calyx.sys"] = {
      sys_cart_count: () => sysCarts.length,
      sys_input_method: () => state.inputMethod,
      sys_cart_info: (i, ptr) => {
        const cart = sysCarts[i];
        if (!cart) return -1;
        const record = encodeCartInfo(cart);
        writeBytes(ptr, record);
        return record.length;
      },
      sys_cart_icon: (i, ptr) => {
        const cart = sysCarts[i];
        if (!cart) return -1;
        writeBytes(ptr, cart.icon ?? placeholderIcon(i));
        return 4096;
      },
      sys_launch: (i) => {
        if (i < 0 || i >= sysCarts.length) {
          throw new Trap(`sys_launch(${i}) out of range (0..${sysCarts.length})`);
        }
        state.sys.push({ op: "launch", i });
      },
      sys_exit: () => state.sys.push({ op: "exit" }),
    };
  }

  const instantiated = await WebAssembly.instantiate(wasmBytes, imports);
  const instance = instantiated instanceof WebAssembly.Instance
    ? instantiated
    : instantiated.instance;
  mem = instance.exports.memory;
  for (const fn of ["start", "update"]) {
    if (typeof instance.exports[fn] !== "function") {
      throw new Error(`cart does not export ${fn}()`);
    }
  }

  const makeFault = (f, e) => {
    if (state.abortMsg !== null) {
      const msg = state.abortMsg;
      state.abortMsg = null;
      return { f, kind: "abort", msg };
    }
    return { f, kind: "trap", msg: String((e && e.message) || e) };
  };

  const advance = (btn) => {
    state.btn = btn;
    state.traces = [];
    state.audio = [];
    state.sys = [];
    resourceMeter?.reset();
    try {
      instance.exports.update();
      resourceMeter?.memory(mem.buffer.byteLength);
    } catch (e) {
      return { fault: makeFault(state.frame, e) };
    }
    const events = {
      f: state.frame,
      audio: state.audio.slice(),
      trace: state.traces.slice(),
      sys: state.sys.slice(),
    };
    state.frame++;
    return { events };
  };

  return {
    fb,
    palette,
    width: w,
    height: h,
    get frame() {
      return state.frame;
    },

    setInputMethod(method) {
      state.inputMethod = method | 0;
    },

    /** Run start(); returns a fault record or null. */
    start() {
      state.inStart = true;
      resourceMeter?.reset();
      try {
        instance.exports.start();
        resourceMeter?.memory(mem.buffer.byteLength);
      } catch (e) {
        state.inStart = false;
        return makeFault(-1, e);
      }
      state.inStart = false;
      return null;
    },

    /**
     * Advance one frame with held buttons `btn`. Returns
     * `{ rec }` (the verified per-frame record, with `rawHash` BigInt) or
     * `{ fault }`. The frame counter auto-increments.
     */
    step(btn) {
      const { events, fault } = advance(btn);
      if (fault) return { fault };
      const rawHash = fb.hash();
      const rec = {
        ...events,
        hash: hex16(rawHash),
        rawHash,
        btn: names(btn),
      };
      return { rec };
    },

    /** Advance one interactive frame without hashing the framebuffer. */
    stepLive(btn) {
      const { events, fault } = advance(btn);
      return fault ? { fault } : { rec: events };
    },
  };
}

/**
 * Load a cart and run it headless for `frames` frames against the feed,
 * returning the verified report (run_hash gate + per-frame records). The
 * headless driver over `createHost` — identical state, no presenter.
 *
 * @param {Uint8Array} wasmBytes
 * @param {{frames:number, at?:(f:number)=>number, w?:number, h?:number,
 *          inputLabel?:string, onFrame?:(host:object, rec:object)=>void}} cfg
 *   `onFrame` receives the live host (use `host.fb` + `host.palette`).
 * @param {string} cartName
 */
export async function run(wasmBytes, cfg, cartName = "cart") {
  const at = cfg.at ?? (() => 0);
  const inputMethodAt = cfg.inputMethodAt ?? (() => 0);
  const host = await createHost(wasmBytes, {
    w: cfg.w,
    h: cfg.h,
    system: cfg.system,
    carts: cfg.carts,
    inputMethod: inputMethodAt(0),
  });

  const report = {
    cart: cartName,
    w: host.width,
    h: host.height,
    palette_id: "SWEETIE_16",
    frames_run: 0,
    run_hash: "",
    final_hash: "",
    frames: [],
    fault: null,
    input_label: cfg.inputLabel ?? "(none)",
    system: !!cfg.system,
  };

  const startFault = host.start();
  if (host.fb.colorMode === 1) report.color = "rgba8888";
  if (startFault) {
    report.fault = startFault;
    report.palette_id = host.palette.id();
    return report;
  }

  let runHash = FNV_OFFSET;
  let lastHash = 0n;
  for (let f = 0; f < cfg.frames; f++) {
    host.setInputMethod(inputMethodAt(f));
    const { rec, fault } = host.step(at(f));
    if (fault) {
      report.fault = fault;
      break;
    }
    runHash = fnvWrite(runHash, le8(rec.rawHash));
    lastHash = rec.rawHash;
    const row = { f: rec.f, hash: rec.hash, btn: rec.btn, audio: rec.audio, trace: rec.trace };
    if (cfg.system) row.sys = rec.sys;
    report.frames.push(row);
    report.frames_run = f + 1;
    if (cfg.onFrame) cfg.onFrame(host, rec);
  }

  report.run_hash = hex16(runHash);
  report.final_hash = hex16(lastHash);
  report.palette_id = host.palette.id();
  return report;
}
