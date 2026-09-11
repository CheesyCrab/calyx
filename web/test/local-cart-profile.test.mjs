import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_CART_LIMITS,
  inspectLocalCart,
} from "../src/local-cart-profile.mjs";

const u32 = (value) => {
  const out = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
};
const bytes = (text) => [...new TextEncoder().encode(text)];
const vec = (items) => [...u32(items.length), ...items.flat()];
const section = (id, payload) => [id, ...u32(payload.length), ...payload];
const name = (value) => [...u32(bytes(value).length), ...bytes(value)];
const funcType = (params = [], results = []) => [0x60, ...vec(params.map((v) => [v])), ...vec(results.map((v) => [v]))];

const I32 = 0x7f;

function cartModule({
  frameType = 1,
  blitArity = null,
  memoryFlags = 1,
  memoryInitial = 1,
  memoryMaximum = 1024,
  table = null,
  extraImport = null,
} = {}) {
  const types = section(1, vec([
    funcType(),
    funcType([], [I32]),
    funcType([I32, I32, I32, I32]),
    funcType(Array(blitArity ?? 0).fill(I32)),
  ]));
  const imports = [
    [...name("env"), ...name("abort"), 0, ...u32(2)],
    [...name("calyx"), ...name("frame"), 0, ...u32(frameType)],
  ];
  if (extraImport) imports.push([...name(extraImport.module), ...name(extraImport.name), 0, ...u32(0)]);
  if (blitArity !== null) imports.push([...name("calyx"), ...name("blit"), 0, ...u32(3)]);
  const importSection = section(2, vec(imports));
  const functions = section(3, vec([[...u32(0)], [...u32(0)]]));
  let tableSection = [];
  if (table) {
    const tables = Array.isArray(table) ? table : [table];
    tableSection = section(4, vec(tables.map((entry) => {
      const tableLimits = [entry.flags, ...u32(entry.initial)];
      if (entry.flags & 1) tableLimits.push(...u32(entry.maximum));
      return [0x70, ...tableLimits];
    })));
  }
  const memoryLimits = [memoryFlags, ...u32(memoryInitial)];
  if (memoryFlags & 1) memoryLimits.push(...u32(memoryMaximum));
  const memory = section(5, vec([memoryLimits]));
  const firstDefined = imports.length;
  const exports = section(7, vec([
    [...name("start"), 0, ...u32(firstDefined)],
    [...name("update"), 0, ...u32(firstDefined + 1)],
    [...name("memory"), 2, ...u32(0)],
  ]));
  const code = section(10, vec([[2, 0, 0x0b], [2, 0, 0x0b]]));
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...types, ...importSection, ...functions, ...tableSection, ...memory, ...exports, ...code,
  ]);
}

test("local cart profile admits a bounded ordinary ABI cart", () => {
  const report = inspectLocalCart(cartModule());
  assert.equal(report.memory.initial, 1);
  assert.equal(report.memory.maximum, 1024);
  assert.deepEqual(report.exports.slice(0, 3).map((entry) => entry.name), ["start", "update", "memory"]);
});

test("local cart profile rejects privileged and unknown imports", () => {
  assert.throws(
    () => inspectLocalCart(cartModule({ extraImport: { module: "calyx.sys", name: "sys_exit" } })),
    /system access/,
  );
  assert.throws(
    () => inspectLocalCart(cartModule({ extraImport: { module: "wasi_snapshot_preview1", name: "fd_write" } })),
    /unsupported host module/,
  );
});

test("local cart profile validates ABI function signatures", () => {
  assert.throws(() => inspectLocalCart(cartModule({ frameType: 0 })), /calyx\.frame.*signature/);
});

test("local cart profile requires a generous but finite memory ceiling", () => {
  assert.throws(() => inspectLocalCart(cartModule({ memoryFlags: 0 })), /memory maximum/);
  assert.throws(
    () => inspectLocalCart(cartModule({ memoryMaximum: LOCAL_CART_LIMITS.maximumMemoryPages + 1 })),
    /memory maximum/,
  );
  assert.throws(
    () => inspectLocalCart(cartModule({ memoryInitial: LOCAL_CART_LIMITS.maximumInitialMemoryPages + 1 })),
    /initial memory/,
  );
});

test("local cart profile rejects malformed and oversized input before execution", () => {
  assert.throws(() => inspectLocalCart(new Uint8Array([0, 1, 2])), /WebAssembly module/);
  assert.throws(
    () => inspectLocalCart(new Uint8Array(LOCAL_CART_LIMITS.maximumFileBytes + 1)),
    /larger than 8 MiB/,
  );
});

test("local cart profile bounds declared function tables", () => {
  assert.doesNotThrow(() => inspectLocalCart(cartModule({
    table: { flags: 1, initial: 4, maximum: 4 },
  })));
  assert.throws(() => inspectLocalCart(cartModule({
    table: { flags: 0, initial: 4, maximum: 0 },
  })), /tables need a declared maximum/);
  assert.throws(() => inspectLocalCart(cartModule({
    table: { flags: 1, initial: 4, maximum: LOCAL_CART_LIMITS.maximumTableEntries + 1 },
  })), /function table maximum/);
  assert.throws(() => inspectLocalCart(cartModule({
    table: Array.from({ length: LOCAL_CART_LIMITS.maximumTableCount + 1 }, () => ({
      flags: 1, initial: 1, maximum: 1,
    })),
  })), /more than .* function tables/);
  assert.throws(() => inspectLocalCart(cartModule({
    table: [
      { flags: 1, initial: 2049, maximum: 32769 },
      { flags: 1, initial: 2048, maximum: 32768 },
    ],
  })), /combined initial function tables/);
});

test("local cart profile rejects malformed limits and indices fail closed", () => {
  assert.throws(() => inspectLocalCart(cartModule({ memoryFlags: 2 })), /limits flags/);
  const truncated = cartModule().slice(0, -1);
  assert.throws(() => inspectLocalCart(truncated), /WebAssembly module/);
});


test("local cart profile admits the eight-argument sprite blit and rejects wrong arities", () => {
  const valid = cartModule({ blitArity: 8 });
  assert.equal(WebAssembly.validate(valid), true);
  assert.doesNotThrow(() => inspectLocalCart(valid));
  for (const blitArity of [7, 9]) {
    assert.throws(() => inspectLocalCart(cartModule({ blitArity })), /calyx\.blit.*signature/);
  }
});
