// Web runtime unit gate (node --test) — the fast, cart-free checks that
// mirror core's unit tests. The full cross-runtime parity gate is
// `node conform.mjs`; these guard the parity-critical primitives directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { hashBytes, hex16, le8, FNV_OFFSET } from "../src/fnv.mjs";
import { Framebuffer } from "../src/framebuffer.mjs";
import { readStandardGamepad } from "../src/canvas.mjs";
import { PresenterInput } from "../src/presenter-input.mjs";
import { Palette } from "../src/palette.mjs";
import { Font, drawText } from "../src/font.mjs";
import {
  INPUT_METHOD,
  names,
  maskFromNames,
  parseCarts,
  parseFeed,
  parseInputMethods,
  shellAction,
} from "../src/input.mjs";
import { createHost, createResourceMeter, encodeCartInfo } from "../src/runtime.mjs";
import { LOCAL_CART_LIMITS } from "../src/local-cart-profile.mjs";
import { PerfStats, summarizePerf } from "../src/perf-stats.mjs";
import M6X11 from "../src/m6x11.mjs";

const enc = (s) => new TextEncoder().encode(s);

test("web presenter performance windows report FPS and mean stage times", () => {
  const perf = new PerfStats(100);
  perf.recordSim(1);
  perf.recordSim(3);
  assert.equal(perf.recordPresentation({ rgbMs: 2, canvasMs: 4 }, 600), null);
  const sample = perf.recordPresentation({ rgbMs: 4, canvasMs: 6 }, 1100);
  assert.deepEqual(sample, {
    fps: 2,
    simMs: 2,
    rgbMs: 3,
    canvasMs: 5,
    presents: 2,
    simSamples: 2,
  });
  assert.deepEqual(summarizePerf({ fps: 29.96, simMs: .65, rgbMs: 10.17, canvasMs: 1.17 }, 30), {
    fps: "30.0/30",
    sim: "0.65",
    draw: "11.34",
    work: "38%",
  });
});

const EVENT_CART = new Uint8Array([
  0,97,115,109,1,0,0,0,1,23,4,96,0,1,127,96,5,127,127,127,127,127,0,96,4,127,127,127,127,0,
  96,0,0,2,41,3,5,99,97,108,121,120,5,102,114,97,109,101,0,0,5,99,97,108,121,120,4,114,101,
  99,116,0,1,5,99,97,108,121,120,4,116,111,110,101,0,2,3,3,2,3,3,5,3,1,0,1,7,27,3,6,109,
  101,109,111,114,121,2,0,5,115,116,97,114,116,0,3,6,117,112,100,97,116,101,0,4,10,30,2,2,0,
  11,25,0,16,0,65,0,65,1,65,1,65,7,16,1,65,184,3,65,2,65,30,65,0,16,2,11,0,27,4,110,97,
  109,101,1,20,3,0,5,102,114,97,109,101,1,4,114,101,99,116,2,4,116,111,110,101,
]);

test("live step matches verified effects without returning a hash", async () => {
  const verified = await createHost(EVENT_CART, { w: 4, h: 2 });
  const live = await createHost(EVENT_CART, { w: 4, h: 2 });
  assert.equal(verified.start(), null);
  assert.equal(live.start(), null);

  const { rec: record } = verified.step(1 << 4);
  const { rec: frame } = live.stepLive(1 << 4);

  assert.deepEqual(frame, {
    f: record.f,
    audio: record.audio,
    trace: record.trace,
    sys: record.sys,
  });
  assert.equal(Object.hasOwn(frame, "hash"), false);
  assert.deepEqual([...live.fb.px], [...verified.fb.px]);
  assert.equal(live.fb.hash(), record.rawHash);
});

test("fnv matches canonical 64-bit vectors", () => {
  assert.equal(hashBytes(enc("")), FNV_OFFSET);
  assert.equal(hashBytes(enc("a")), 0xaf63dc4c8601ec8cn);
  assert.equal(hashBytes(enc("foobar")), 0x85944171f73967e8n);
  assert.equal(hex16(FNV_OFFSET), "cbf29ce484222325");
});

test("le8 is little-endian 8 bytes", () => {
  assert.deepEqual([...le8(0x0102n)], [2, 1, 0, 0, 0, 0, 0, 0]);
});

test("framebuffer clips silently and ignores nonpositive sizes", () => {
  const fb = new Framebuffer(4, 4);
  fb.set(-1, 0, 9);
  fb.set(4, 0, 9);
  fb.set(0, 4, 9);
  assert.ok(fb.px.every((p) => p === 0));
  fb.rect(2, 2, 100, 100, 5); // overruns far past the edge
  assert.equal(fb.px[2 * 4 + 2], 5);
  assert.equal(fb.px[3 * 4 + 3], 5);
  fb.cls(0);
  fb.rect(0, 0, 0, 5, 5);
  fb.rect(0, 0, 5, -3, 5);
  assert.ok(fb.px.every((p) => p === 0));
});

test("blit 1:1 with flips and color-key", () => {
  const src = new Uint8Array([1, 2, 0, 3]); // top [1,2], bottom [0,3]
  const fb = new Framebuffer(4, 4);
  fb.blit(src, 2, 2, 0, 0, 2, 2, 0);
  assert.deepEqual([...fb.px.slice(0, 2)], [1, 2]);
  assert.deepEqual([...fb.px.slice(4, 6)], [0, 3]);
  fb.cls(0);
  fb.blit(src, 2, 2, 0, 0, 2, 2, 1); // flip-x
  assert.deepEqual([...fb.px.slice(0, 2)], [2, 1]);
  fb.cls(9);
  fb.blit(src, 2, 2, 0, 0, 2, 2, 4); // color-key: index 0 transparent
  assert.equal(fb.px[4], 9);
  assert.equal(fb.px[5], 3);
});

test("fast 1:1 blit handles clipping, flips, keys, and short sources", () => {
  const source = new Uint8Array([1, 0, 2, 3, 4, 5, 0, 6, 7, 8, 9, 10]);
  const scalar = (fb, src, x, y, flags) => {
    for (let dy = 0; dy < 3; dy++) {
      const sy = flags & 2 ? 2 - dy : dy;
      for (let dx = 0; dx < 4; dx++) {
        const sx = flags & 1 ? 3 - dx : dx;
        const at = sy * 4 + sx;
        if (at >= src.length || ((flags & 4) && src[at] === 0)) continue;
        fb.set(x + dx, y + dy, src[at]);
      }
    }
  };
  for (let flags = 0; flags < 16; flags++) {
    for (const [x, y] of [[-5, -4], [-1, 1], [0, 0], [5, 4], [0x7fffffff, 0]]) {
      for (let length = 0; length <= source.length; length++) {
        const want = new Framebuffer(7, 6);
        const got = new Framebuffer(7, 6);
        want.cls(13);
        got.cls(13);
        scalar(want, source.subarray(0, length), x, y, flags);
        got.blit(source.subarray(0, length), 4, 3, x, y, 4, 3, flags);
        assert.deepEqual([...got.px], [...want.px]);
      }
    }
  }
});

test("palette: default id and custom digest", () => {
  const p = new Palette();
  assert.equal(p.id(), "SWEETIE_16");
  const rgb = new Uint8Array([10, 20, 30, 40, 50, 60]);
  p.setFromRgb(rgb, 2);
  assert.deepEqual(p.rgb(0), [10, 20, 30]);
  assert.equal(p.id(), `custom:${hex16(hashBytes(rgb))}`);
});

test("font: printable ascii present, others use placeholder, scaling", () => {
  const f = new Font();
  for (let b = 0x20; b <= 0x7e; b++) assert.ok(f.glyphs.has(b), `missing ${b}`);
  assert.equal(f.glyph(0x01).advance, f.placeholder.advance);
  assert.deepEqual(f.glyph(0xff).rows, f.placeholder.rows);

  const a = new Framebuffer(64, 32);
  drawText(a, f, 0, 0, enc("A"), 1, 1);
  const n1 = a.px.reduce((s, p) => s + (p === 1 ? 1 : 0), 0);
  assert.ok(n1 > 0);
  const b = new Framebuffer(64, 32);
  drawText(b, f, 0, 0, enc("A"), 1, 2);
  const n2 = b.px.reduce((s, p) => s + (p === 1 ? 1 : 0), 0);
  assert.equal(n2, n1 * 4);
});

test("embedded m6x11 has not drifted from the canonical artifact", () => {
  const canonical = JSON.parse(
    readFileSync(new URL("../../assets/fonts/m6x11-v1.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(M6X11, canonical, "run `node tools/gen-font.mjs` to regenerate");
});

test("input: names roundtrip and feed persistence", () => {
  const mask = maskFromNames(["a", "RIGHT", "x", "Y", "l", "R"]);
  assert.equal(mask, (1 << 3) | (1 << 4) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10));
  assert.deepEqual(names(mask), ["RIGHT", "A", "X", "Y", "L", "R"]);
  assert.throws(() => maskFromNames(["JUMP"]));

  const at = parseFeed([{ f: 0, hold: ["RIGHT"] }, { f: 10, hold: [] }]);
  assert.equal(at(0), 1 << 3);
  assert.equal(at(9), 1 << 3);
  assert.equal(at(10), 0);
});

test("input: extended keyboard and standard gamepad append stable bits", () => {
  const input = new PresenterInput({ inputProfile: "extended" });
  for (const [code, bit] of [["KeyA", 7], ["KeyS", 8], ["KeyQ", 9], ["KeyW", 10]]) {
    assert.equal(input.keyDown(code).accepted, true);
    assert.ok(input.heldMask() & (1 << bit));
    input.keyUp(code);
  }

  const pressed = new Set([2, 3, 4, 5]);
  const gamepad = {
    connected: true,
    mapping: "standard",
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })),
  };
  assert.equal(
    readStandardGamepad(gamepad).mask,
    (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10),
  );
});

test("input: Classic gamepad profile masks extended face and shoulder bits", () => {
  const input = new PresenterInput();
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  for (const index of [2, 3, 4, 5]) buttons[index].pressed = true;
  const pad = { connected: true, mapping: "standard", buttons };

  const polled = input.pollGamepad(pad);
  assert.equal(polled.pressedMask, 0);
  assert.equal(polled.meaningful, false);
  assert.equal(input.heldMask(), 0);
});

test("system cart metadata appends the ABI v1.2 category field", () => {
  const [cart] = parseCarts({
    carts: [{ name: "x", author: "a", version: "1.0", category: "Demos" }],
  });
  assert.equal(cart.category, "Demos");
  const record = encodeCartInfo(cart);
  let pos = 0;
  const fields = [];
  for (let i = 0; i < 4; i++) {
    const len = record[pos] | (record[pos + 1] << 8);
    pos += 2;
    fields.push(new TextDecoder().decode(record.slice(pos, pos + len)));
    pos += len;
  }
  assert.deepEqual(fields, ["x", "a", "1.0", "Demos"]);
  assert.equal(parseCarts({ carts: [{ name: "old" }] })[0].category, "Games");
  assert.throws(
    () => parseCarts({ carts: [{ name: "x", category: "c".repeat(32) }] }),
    /31-byte ABI cap/,
  );
});

test("direct system hosts reject malformed cart metadata and icons like native", async () => {
  await assert.rejects(
    createHost(new Uint8Array(), {
      system: true,
      carts: [{ name: "x", icon: new Uint8Array(1024) }],
    }),
    /icon must be exactly 4096 bytes/,
  );
  await assert.rejects(
    createHost(new Uint8Array(), {
      system: true,
      carts: [{ name: "x".repeat(64) }],
    }),
    /63-byte ABI cap/,
  );
});

test("opt-in guest resource meter rejects trace and tone floods synchronously", () => {
  const meter = createResourceMeter(LOCAL_CART_LIMITS);
  meter.reset();
  assert.throws(() => meter.trace(LOCAL_CART_LIMITS.maximumTraceBytes + 1), /trace message/);
  meter.reset();
  for (let i = 0; i < 16; i++) meter.trace(LOCAL_CART_LIMITS.maximumTraceBytes);
  assert.throws(() => meter.trace(1), /trace output/);
  meter.reset();
  for (let i = 0; i < LOCAL_CART_LIMITS.maximumToneEventsPerFrame; i++) meter.tone(60);
  assert.throws(() => meter.tone(60), /tone events/);
  meter.reset();
  assert.throws(() => meter.tone(LOCAL_CART_LIMITS.maximumToneDurationFrames + 1), /tone duration/);
  meter.reset();
  assert.throws(
    () => meter.tone(LOCAL_CART_LIMITS.maximumNoiseDurationFrames + 1, 3),
    /noise duration/,
  );
  meter.reset();
  meter.tone(LOCAL_CART_LIMITS.maximumNoiseDurationFramesPerFrame / 2, 3);
  meter.tone(LOCAL_CART_LIMITS.maximumNoiseDurationFramesPerFrame / 2, 3);
  assert.throws(() => meter.tone(1, 3), /combined noise duration/);
  meter.reset();
  meter.tone(LOCAL_CART_LIMITS.maximumToneDurationFramesPerFrame / 2);
  meter.tone(LOCAL_CART_LIMITS.maximumToneDurationFramesPerFrame / 2);
  assert.throws(() => meter.tone(1), /combined tone duration/);
});

test("opt-in guest resource meter checks post-call memory growth", () => {
  const meter = createResourceMeter(LOCAL_CART_LIMITS);
  assert.doesNotThrow(() => meter.memory(LOCAL_CART_LIMITS.maximumMemoryPages * 65536));
  assert.throws(() => meter.memory((LOCAL_CART_LIMITS.maximumMemoryPages + 1) * 65536), /memory limit/);
});

test("input method feed defaults to keyboard and persists explicit changes", () => {
  const at = parseInputMethods([
    { f: 2, hold: ["A"], method: "CONTROLLER" },
    { f: 8, hold: [], method: "TOUCH" },
  ]);
  assert.equal(at(0), INPUT_METHOD.KEYBOARD);
  assert.equal(at(2), INPUT_METHOD.CONTROLLER);
  assert.equal(at(7), INPUT_METHOD.CONTROLLER);
  assert.equal(at(8), INPUT_METHOD.TOUCH);
  assert.throws(() => parseInputMethods([{ f: 0, method: "MOUSE" }]), /unknown input method/);
});

test("shell keys keep quit and return-home distinct", () => {
  assert.equal(shellAction("Escape", true), "quit");
  assert.equal(shellAction("Escape", false), "quit");
  assert.equal(shellAction("Backspace", false), "home");
  assert.equal(shellAction("Backspace", true), null);
});

test("standard gamepad preserves the Classic face and shell buttons", () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  for (const i of [0, 1, 9, 12, 13, 14, 15, 8, 16]) buttons[i].pressed = true;
  const state = readStandardGamepad({ connected: true, mapping: "standard", buttons });
  assert.equal(state.mask, 0x7f);
  assert.equal(state.back, true);
  assert.equal(state.guide, true);

  buttons[0].pressed = true;
  assert.deepEqual(
    readStandardGamepad({ connected: true, mapping: "", buttons }),
    { mask: 0, back: false, guide: false },
  );
});

test("presenter input combines keyboard and gamepad and suppresses stale holds", () => {
  const input = new PresenterInput();
  assert.equal(input.keyDown("KeyZ").method, INPUT_METHOD.KEYBOARD);
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  buttons[15].pressed = true;
  let event = input.pollGamepad({ connected: true, mapping: "standard", buttons });
  assert.equal(event.method, INPUT_METHOD.CONTROLLER);
  assert.equal(input.heldMask(), (1 << 4) | (1 << 3));

  input.clear({ suppressGamepad: true });
  input.pollGamepad({ connected: true, mapping: "standard", buttons });
  assert.equal(input.heldMask(), 0);
  buttons[15].pressed = false;
  input.pollGamepad({ connected: true, mapping: "standard", buttons });
  buttons[12].pressed = true;
  event = input.pollGamepad({ connected: true, mapping: "standard", buttons });
  assert.equal(event.meaningful, true);
  assert.equal(input.heldMask(), 1 << 0);
});

test("presenter input ORs touch into the same semantic seven-button mask", () => {
  const input = new PresenterInput();
  input.keyDown("KeyZ");
  input.setTouchMask((1 << 0) | (1 << 3) | (1 << 7) | (1 << 10));
  assert.equal(input.heldMask(), (1 << 4) | (1 << 0) | (1 << 3));
  input.clear();
  assert.equal(input.heldMask(), 0);
});

test("presenter input admits extended touch bits only for the extended profile", () => {
  const input = new PresenterInput({ inputProfile: "extended" });
  input.setTouchMask(0x7ff);
  assert.equal(input.heldMask(), 0x7ff);

  input.setInputProfile("classic");
  assert.equal(input.heldMask(), 0);
  input.setTouchMask((1 << 4) | (1 << 7) | (1 << 10));
  assert.equal(input.heldMask(), 1 << 4);
});

test("presenter cleanup hooks run on every logical clear", () => {
  const input = new PresenterInput();
  let calls = 0;
  const remove = input.addCleanupHook(() => { calls += 1; });
  input.clear();
  remove();
  input.clear();
  assert.equal(calls, 1);
});
