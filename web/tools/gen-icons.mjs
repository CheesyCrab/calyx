// Reproducibly derive committed raster PWA icons from the canonical Calyx SVG.
// Browser rasterization is only a regeneration tool; release builds copy the
// committed PNG bytes and guard their source hash.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(WEB);
const outputs = [
  ["icon-192.png", 192, 88],
  ["icon-512.png", 512, 88],
  ["icon-maskable-192.png", 192, 66],
  ["icon-maskable-512.png", 512, 66],
  ["apple-touch-icon.png", 180, 78],
];

const variants = [
  { prefix: "", source: "calyx-mark.svg", background: "#1a1c2c" },
  { prefix: "sideb-", source: "calyx-sideb-mark.svg", background: "#1a1c2c" },
];

await mkdir(WEB, { recursive: true });
const browser = await chromium.launch();
try {
  for (const variant of variants) {
    const sourcePath = join(ROOT, "assets", "brand", variant.source);
    const svg = await readFile(sourcePath, "utf8");
    const sourceSha256 = createHash("sha256").update(svg).digest("hex");
    for (const [name, size, markPercent] of outputs) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<!doctype html><style>
        html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${variant.background}}
        body{display:grid;place-items:center}
        svg{width:${markPercent}%;height:${markPercent}%}
      </style>${svg}`);
      await page.screenshot({
        path: join(WEB, `${variant.prefix}${name}`),
        type: "png",
        animations: "disabled",
      });
      await page.close();
    }
    await writeFile(join(WEB, `${variant.prefix}icon-source.json`), JSON.stringify({
      source: `../assets/brand/${variant.source}`,
      source_sha256: sourceSha256,
      generator: "web/tools/gen-icons.mjs",
      background: variant.background,
      outputs: Object.fromEntries(outputs.map(([name, size]) => [`${variant.prefix}${name}`, size])),
    }, null, 2) + "\n");
  }
} finally {
  await browser.close();
}
