#!/usr/bin/env node
// Intentional regeneration for committed Windows ICO and macOS ICNS marks.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "brand", "native");
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const ICNS_SIZES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
];
const PRODUCTS = {
  release: {
    source: "assets/brand/calyx-mark.svg",
    ico: "assets/brand/native/calyx.ico",
    icns: "assets/brand/native/Calyx.icns",
  },
  sideb: {
    source: "assets/brand/calyx-sideb-mark.svg",
    ico: "assets/brand/native/calyx-sideb.ico",
    icns: "assets/brand/native/Calyx-Side-B.icns",
  },
};

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const u16le = (value) => {
  const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes;
};
const u32le = (value) => {
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;
};
const u32be = (value) => {
  const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes;
};

function packIco(images) {
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const [size, png] of images) {
    entries.push(Buffer.concat([
      Buffer.from([size === 256 ? 0 : size, size === 256 ? 0 : size, 0, 0]),
      u16le(1), u16le(32), u32le(png.length), u32le(offset),
    ]));
    offset += png.length;
  }
  return Buffer.concat([
    u16le(0), u16le(1), u16le(images.length), ...entries,
    ...images.map(([, png]) => png),
  ]);
}

function packIcns(images) {
  const chunks = images.map(([type, png]) =>
    Buffer.concat([Buffer.from(type, "ascii"), u32be(png.length + 8), png]));
  const body = Buffer.concat(chunks);
  return Buffer.concat([Buffer.from("icns", "ascii"), u32be(body.length + 8), body]);
}

async function render(page, source, size) {
  const svg = source.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;background:transparent}</style>${svg}`
  );
  return page.locator("svg").screenshot({ omitBackground: true });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const manifest = { schema: 1, generator: "tools/gen_native_icons.mjs", products: {} };
try {
  for (const [profile, product] of Object.entries(PRODUCTS)) {
    const source = await readFile(join(ROOT, product.source));
    const rendered = new Map();
    for (const size of new Set([...ICO_SIZES, ...ICNS_SIZES.map(([, size]) => size)])) {
      rendered.set(size, await render(page, source.toString("utf8"), size));
    }
    const ico = packIco(ICO_SIZES.map((size) => [size, rendered.get(size)]));
    const icns = packIcns(ICNS_SIZES.map(([type, size]) => [type, rendered.get(size)]));
    await writeFile(join(ROOT, product.ico), ico);
    await writeFile(join(ROOT, product.icns), icns);
    manifest.products[profile] = {
      source: { path: product.source, sha256: hash(source) },
      outputs: [
        { path: product.ico, sha256: hash(ico), bytes: ico.length },
        { path: product.icns, sha256: hash(icns), bytes: icns.length },
      ],
    };
    process.stdout.write(`wrote ${relative(ROOT, join(ROOT, product.ico))}\n`);
    process.stdout.write(`wrote ${relative(ROOT, join(ROOT, product.icns))}\n`);
  }
} finally {
  await browser.close();
}
await writeFile(
  join(OUT, "icon-source.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write("wrote assets/brand/native/icon-source.json\n");
