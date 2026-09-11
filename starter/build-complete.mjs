import { statSync } from "node:fs";

const output = new URL("./cart.wasm", import.meta.url);
if (statSync(output).size === 0) throw new Error("cart.wasm is empty");
console.log("Built cart.wasm — choose this file in Calyx.");
