import test from "node:test";
import assert from "node:assert/strict";

import { LocalCartClient } from "../src/local-cart-client.mjs";

class FakeWorker {
  constructor() {
    this.messages = [];
    this.listeners = new Map();
    this.terminated = false;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  postMessage(message) { this.messages.push(message); }
  emit(data) { this.listeners.get("message")?.({ data }); }
  emitError(name, message = "") { this.listeners.get(name)?.({ message }); }
  terminate() { this.terminated = true; }
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

test("local cart client follows phase messages and accepts one matching ready reply", async () => {
  const worker = new FakeWorker();
  const client = new LocalCartClient({ worker, sessionId: "current" });
  const loading = client.load(new Uint8Array([1, 2, 3]));
  assert.equal(worker.messages[0].type, "load");
  worker.emit({ sessionId: "stale", type: "ready" });
  worker.emit({ sessionId: "current", type: "phase", phase: "instantiate" });
  worker.emit({
    sessionId: "current", type: "ready", frame: new Uint8Array(4).buffer,
    width: 2, height: 2, palette: [[0, 0, 0]], rec: { f: 0, audio: [] },
  });
  const ready = await loading;
  assert.equal(ready.fb.px.length, 4);
  assert.equal(client.phase, "ready");
});

test("local cart client keeps one step in flight and recycles the frame buffer", async () => {
  const worker = new FakeWorker();
  const client = new LocalCartClient({ worker, sessionId: "s" });
  const loading = client.load(new Uint8Array([1]));
  worker.emit({
    sessionId: "s", type: "ready", frame: new Uint8Array(4).buffer,
    width: 2, height: 2, palette: [[0, 0, 0]], rec: { f: 0, audio: [] },
  });
  await loading;
  assert.equal(client.step(3, 1), true);
  assert.equal(client.step(3, 1), false);
  assert.equal(worker.messages.at(-1).type, "step");
  worker.emit({
    sessionId: "s", type: "frame", frame: new Uint8Array([1, 2, 3, 4]).buffer,
    rec: { f: 1, audio: [] },
  });
  assert.deepEqual([...client.fb.px], [1, 2, 3, 4]);
  assert.equal(client.step(0, 0), true);
});

test("local cart client terminates a worker that misses a phase watchdog", async () => {
  const worker = new FakeWorker();
  const client = new LocalCartClient({
    worker, sessionId: "slow", timeouts: { compile: 5 },
  });
  const loading = client.load(new Uint8Array([1]));
  await assert.rejects(loading, /compile timed out/);
  assert.equal(worker.terminated, true);
});

test("disposing ignores stale replies and rejects outstanding work", async () => {
  const worker = new FakeWorker();
  const client = new LocalCartClient({ worker, sessionId: "gone" });
  const loading = client.load(new Uint8Array([1]));
  client.dispose();
  worker.emit({ sessionId: "gone", type: "ready", frame: new ArrayBuffer(1) });
  await assert.rejects(loading, /ended/);
  await nextTask();
  assert.equal(worker.terminated, true);
});

test("an unreadable worker message fails and terminates the session", async () => {
  const worker = new FakeWorker();
  const client = new LocalCartClient({ worker, sessionId: "bad-message" });
  const loading = client.load(new Uint8Array([1]));
  worker.emitError("messageerror");
  await assert.rejects(loading, /unreadable message/);
  assert.equal(worker.terminated, true);
});

test("local cart client preserves RGBA format and recycles four-byte pixels", async () => {
  const worker = new FakeWorker();
  const client = new LocalCartClient({ worker, sessionId: "rgba" });
  const loading = client.load(new Uint8Array([1]));
  worker.emit({sessionId:"rgba",type:"ready",colorMode:1,width:320,height:240,
    frame:new Uint8Array(320*240*4).buffer,palette:[],rec:{f:0,audio:[]}});
  const ready = await loading;
  assert.equal(ready.fb.colorMode,1);
  assert.equal(ready.fb.px.byteLength,320*240*4);
  client.step(0,0);
  assert.equal(worker.messages.at(-1).frame.byteLength,320*240*4);
  worker.emit({sessionId:"rgba",type:"frame",frame:new Uint8Array(320*240*4).fill(255).buffer,rec:{f:1,audio:[]}});
  assert.equal(client.fb.colorMode,1);
  assert.equal(client.fb.px.at(-1),255);
  client.dispose();
});
