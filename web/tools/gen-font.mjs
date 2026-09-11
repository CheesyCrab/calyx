// Generate the browser-embeddable copy of the pinned m6x11 font from the
// canonical artifact (assets/fonts/m6x11-v1.json). The web runtime must run in
// the browser, where node:fs is unavailable, so the font is embedded as a JS
// module — the browser analogue of core's compile-time include_str!. A unit
// test guards the copy against drift. Run after the font artifact changes:
//
//   node tools/gen-font.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const canonical = join(HERE, "..", "..", "assets", "fonts", "m6x11-v1.json");
const data = JSON.parse(readFileSync(canonical, "utf8"));

const out =
  "// GENERATED from assets/fonts/m6x11-v1.json by tools/gen-font.mjs — do not edit.\n" +
  "// The browser-embeddable copy of the pinned m6x11 font (ABI §4 Drawing);\n" +
  "// a unit test guards it against drift from the canonical artifact.\n" +
  `export default ${JSON.stringify(data)};\n`;

writeFileSync(join(HERE, "..", "src", "m6x11.mjs"), out);
console.log("wrote src/m6x11.mjs");
