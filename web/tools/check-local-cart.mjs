#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { inspectLocalCart } from "../src/local-cart-profile.mjs";

const path = process.argv[2];
if (!path) throw new Error("usage: node web/tools/check-local-cart.mjs <cart.wasm>");
const bytes = new Uint8Array(await readFile(path));
await WebAssembly.compile(bytes);
const report = inspectLocalCart(bytes);
console.log(
  `local cart: PASS ${path} (${bytes.byteLength} bytes, ` +
  `memory ${report.memory.initial}..${report.memory.maximum} pages)`,
);
