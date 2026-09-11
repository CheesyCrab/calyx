import { readWasmMetadata } from "./wasm-metadata.mjs";

const I32 = 0x7f;
const signature = (params, results = []) => ({ params, results });

const ORDINARY_IMPORTS = new Map([
  ["env.abort", signature([I32, I32, I32, I32])],
  ["calyx.frame", signature([], [I32])],
  ["calyx.width", signature([], [I32])],
  ["calyx.height", signature([], [I32])],
  ["calyx.cls", signature([I32])],
  ["calyx.pixel", signature([I32, I32, I32])],
  ["calyx.rect", signature([I32, I32, I32, I32, I32])],
  ["calyx.hline", signature([I32, I32, I32, I32])],
  ["calyx.vline", signature([I32, I32, I32, I32])],
  ["calyx.text", signature([I32, I32, I32, I32, I32, I32])],
  ["calyx.blit", signature([I32, I32, I32, I32, I32, I32, I32, I32])],
  ["calyx.set_color_mode", signature([I32])],
  ["calyx.rgba_cls", signature([I32])],
  ["calyx.rgba_rect", signature([I32, I32, I32, I32, I32])],
  ["calyx.rgba_text", signature([I32, I32, I32, I32, I32, I32])],
  ["calyx.clip", signature([I32, I32, I32, I32])],
  ["calyx.clip_reset", signature([])],
  ["calyx.blit_region", signature([I32, I32, I32, I32, I32, I32, I32, I32, I32, I32, I32, I32, I32, I32])],
  ["calyx.set_palette", signature([I32, I32])],
  ["calyx.btn", signature([], [I32])],
  ["calyx.tone", signature([I32, I32, I32, I32])],
  ["calyx.trace", signature([I32, I32])],
]);

export const LOCAL_CART_LIMITS = Object.freeze({
  maximumFileBytes: 8 * 1024 * 1024,
  maximumInitialMemoryPages: 256,
  maximumMemoryPages: 1024,
  maximumInitialTableEntries: 4096,
  maximumTableEntries: 65536,
  maximumTableCount: 4,
  maximumTraceBytes: 4096,
  maximumTraceBytesPerFrame: 64 * 1024,
  maximumToneEventsPerFrame: 32,
  maximumToneDurationFrames: 3600,
  maximumNoiseDurationFrames: 600,
  maximumNoiseDurationFramesPerFrame: 600,
  maximumToneDurationFramesPerFrame: 3600,
});

function sameSignature(actual, expected) {
  return actual &&
    actual.params.length === expected.params.length &&
    actual.results.length === expected.results.length &&
    actual.params.every((value, i) => value === expected.params[i]) &&
    actual.results.every((value, i) => value === expected.results[i]);
}

function lifecycleExport(metadata, name) {
  const entry = metadata.exports.find((candidate) => candidate.name === name);
  if (!entry || entry.kind !== 0) throw new Error(`This cart must export ${name}() as a function.`);
  if (!sameSignature(entry.signature, signature([]))) {
    throw new Error(`The exported ${name} function must have signature () -> ().`);
  }
}

export function inspectLocalCart(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > LOCAL_CART_LIMITS.maximumFileBytes) {
    throw new Error("This cart is larger than 8 MiB.");
  }
  const metadata = readWasmMetadata(bytes);
  for (const entry of metadata.imports) {
    if (entry.module === "calyx.sys") {
      throw new Error("Local carts cannot request Calyx system access.");
    }
    if (entry.kind !== 0) {
      throw new Error(`Local carts cannot import ${entry.module}.${entry.name} (${entry.kind}).`);
    }
    if (entry.module !== "calyx" && entry.module !== "env") {
      throw new Error(`This cart requests unsupported host module '${entry.module}'.`);
    }
    const key = `${entry.module}.${entry.name}`;
    const expected = ORDINARY_IMPORTS.get(key);
    if (!expected) throw new Error(`This cart requests unsupported host function '${key}'.`);
    if (!sameSignature(entry.signature, expected)) {
      throw new Error(`Host function ${key} has the wrong signature.`);
    }
  }
  lifecycleExport(metadata, "start");
  lifecycleExport(metadata, "update");

  if (metadata.memories.length !== 1) {
    throw new Error("A local cart must define exactly one memory.");
  }
  const importedMemory = metadata.imports.some((entry) => entry.kind === 2);
  if (importedMemory) throw new Error("A local cart must define and export its own memory.");
  const memoryExport = metadata.exports.find((entry) => entry.name === "memory");
  if (!memoryExport || memoryExport.kind !== 2 || memoryExport.index !== 0) {
    throw new Error("A local cart must export its memory as 'memory'.");
  }
  const memory = metadata.memories[0];
  if (memory.maximum === null) {
    throw new Error("This cart needs a declared memory maximum; build with --maximumMemory 1024.");
  }
  if (memory.initial > LOCAL_CART_LIMITS.maximumInitialMemoryPages) {
    throw new Error("This cart requests more than 16 MiB of initial memory.");
  }
  if (memory.maximum > LOCAL_CART_LIMITS.maximumMemoryPages) {
    throw new Error("This cart's memory maximum is greater than 64 MiB.");
  }
  if (memory.maximum < memory.initial) throw new Error("This cart has invalid memory bounds.");

  if (metadata.tables.length > LOCAL_CART_LIMITS.maximumTableCount) {
    throw new Error(`This cart declares more than ${LOCAL_CART_LIMITS.maximumTableCount} function tables.`);
  }
  let totalInitialTableEntries = 0;
  let totalMaximumTableEntries = 0;
  for (const table of metadata.tables) {
    if (table.maximum === null) throw new Error("Local cart tables need a declared maximum.");
    if (table.initial > LOCAL_CART_LIMITS.maximumInitialTableEntries) {
      throw new Error("This cart's initial function table is too large.");
    }
    if (table.maximum > LOCAL_CART_LIMITS.maximumTableEntries) {
      throw new Error("This cart's function table maximum is too large.");
    }
    totalInitialTableEntries += table.initial;
    totalMaximumTableEntries += table.maximum;
  }
  if (totalInitialTableEntries > LOCAL_CART_LIMITS.maximumInitialTableEntries) {
    throw new Error("This cart's combined initial function tables are too large.");
  }
  if (totalMaximumTableEntries > LOCAL_CART_LIMITS.maximumTableEntries) {
    throw new Error("This cart's combined function table maximum is too large.");
  }
  return { ...metadata, memory };
}
