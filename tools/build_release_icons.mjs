#!/usr/bin/env node
// Deterministic native-64 launcher marks for release carts whose older
// 32px-derived art did not survive the launcher's 32px/16px depth views.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 64;
const H = 64;

const blank = () => new Uint8Array(W * H);
const set = (p, x, y, c) => {
  if (x >= 0 && y >= 0 && x < W && y < H) p[y * W + x] = c;
};
const rect = (p, x, y, w, h, c) => {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) set(p, xx, yy, c);
  }
};
const line = (p, x0, y0, x1, y1, c, width = 1) => {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    rect(p, x0 - ((width - 1) >> 1), y0 - ((width - 1) >> 1), width, width, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
};
const poly = (p, points, c) => {
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if ((a[1] > y) !== (b[1] > y)) {
        xs.push(Math.round((b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      rect(p, xs[i], y, xs[i + 1] - xs[i] + 1, 1, c);
    }
  }
};
const ellipse = (p, cx, cy, rx, ry, c) => {
  const rr = rx * rx * ry * ry;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if (x * x * ry * ry + y * y * rx * rx <= rr) set(p, cx + x, cy + y, c);
    }
  }
};

function horizonBurn() {
  const p = blank();
  // Top-down interceptor: cyan wing mass, dark fuselage, hot twin exhaust.
  poly(p, [[31, 6], [38, 23], [57, 31], [54, 39], [38, 35], [35, 52], [29, 52], [26, 35], [9, 39], [6, 31], [26, 23]], 12);
  poly(p, [[31, 10], [35, 28], [51, 33], [36, 33], [32, 48], [28, 33], [13, 33], [28, 28]], 11);
  poly(p, [[29, 8], [35, 8], [36, 31], [32, 43], [28, 31]], 14);
  poly(p, [[30, 12], [34, 12], [34, 29], [32, 36], [30, 29]], 2);
  rect(p, 17, 30, 11, 3, 13);
  rect(p, 36, 30, 11, 3, 13);
  poly(p, [[27, 49], [31, 49], [28, 59], [24, 53]], 4);
  poly(p, [[33, 49], [37, 49], [40, 53], [36, 59]], 5);
  rect(p, 30, 7, 4, 3, 1);
  return p;
}

function wormtide() {
  const p = blank();
  // One curling sea-worm with an unmistakable head, eye, and open center.
  for (let width = 12; width >= 8; width -= 2) {
    line(p, 17, 18, 10, 31, width === 12 ? 9 : 8, width);
    line(p, 10, 31, 17, 46, width === 12 ? 9 : 8, width);
    line(p, 17, 46, 34, 53, width === 12 ? 9 : 8, width);
    line(p, 34, 53, 49, 43, width === 12 ? 9 : 8, width);
    line(p, 49, 43, 52, 28, width === 12 ? 9 : 8, width);
  }
  ellipse(p, 19, 17, 11, 9, 7);
  poly(p, [[11, 15], [18, 7], [30, 15], [22, 25], [12, 23]], 8);
  rect(p, 18, 13, 5, 5, 13);
  rect(p, 20, 14, 3, 3, 1);
  poly(p, [[24, 20], [35, 25], [25, 29]], 7);
  line(p, 15, 31, 22, 43, 13, 3);
  line(p, 29, 48, 42, 45, 13, 3);
  return p;
}

function sunnyApiLab() {
  const p = blank();
  // Canonical indexed reduction of assets/brand/sunny-mark.svg. Preserve its
  // four hollow petals, center, and alternating rays instead of inventing
  // cart-specific laboratory imagery.
  const rows = [
    "................................", "................................",
    "................................", "................................",
    "...............yy...............", "...............yy...............",
    "........y......yy......y........", "...............yy...............",
    "......y.......yyyy.......y......", ".............yyyyyy.............",
    ".............yyddyyy............", ".............yddddyy............",
    ".............yddddy.............", ".........yyyydyyyydyyyy.........",
    "........yyyddyyyyyyydyyy........", "....yyyyyydddyydddyyddyyyyyy....",
    "....yyyyyydddyydydyyddyyyyyy....", "........yyyddyydddyydyyy........",
    ".........yyyydyyyyyyyyy.........", "..........yy.yyyyyy.yy..........",
    ".............yddddyy............", ".............yyddyyy............",
    ".............yyyyyy.............", "......y.......yyyy.......y......",
    "...............yy...............", "........y......yy......y........",
    "...............yy...............", "...............yy...............",
    "................................", "................................",
    "................................", "................................",
  ];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const ch = rows[y][x];
      if (ch !== ".") rect(p, x * 2, y * 2, 2, 2, ch === "y" ? 6 : 2);
    }
  }
  return p;
}

const icons = new Map([
  ["horizon-burn", horizonBurn()],
  ["sunny-api-lab", sunnyApiLab()],
  ["wormtide", wormtide()],
]);

for (const [slug, pixels] of icons) {
  const dir = join(ROOT, "carts", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "icon.bin"), pixels);
  process.stdout.write(`wrote carts/${slug}/icon.bin\n`);
}
