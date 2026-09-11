// Headless-browser smoke test of the PWA shell (ROADMAP T7).
//
// Serves the repo over http, loads web/index.html?test in real Chromium, runs
// a known cart in-browser, and checks TWO things against the native oracle:
//   1. window.__calyx.run_hash == the cart's blessed run_hash
//      (the web runtime actually ran in the browser), and
//   2. a hash of the CANVAS pixels == the blessed final_hash
//      (the canvas presenter drew the verified framebuffer — proves the
//      render path, not just the runtime).
// Also saves a screenshot of the rendered canvas as proof.
//
//   node smoke.mjs

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { SWEETIE_16 } from "./src/palette.mjs";

const WEB = dirname(fileURLToPath(import.meta.url));
const CALYX = dirname(WEB);
const SUITE = join(CALYX, "conformance");
const CART = "checker"; // deterministic, SWEETIE_16 (so the canvas LUT is exact)

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error(
    "Playwright is not installed in calyx/web. Run " +
    "`npm install --no-audit --no-fund` there, then " +
    "`npx playwright install chromium`."
  );
  throw error;
}

// Read the cart's blessed expectations + frame count from its manifest.
const toml = readFileSync(join(SUITE, "carts", CART, "cart.toml"), "utf8");
const field = (k) => toml.match(new RegExp(`${k}\\s*=\\s*"?([^"\\n]+)"?`))[1];
const EXP = { run_hash: field("run_hash"), final_hash: field("final_hash") };
const FRAMES = Number(field("frames"));

// Ensure the cart is built (the suite's canonical builder).
if (!existsSync(join(SUITE, "build", `${CART}.wasm`))) {
  execFileSync("python3", ["check.py", "build"], { cwd: SUITE, stdio: "inherit" });
}

const MIME = {
  ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  try {
    let p = join(CALYX, decodeURIComponent(req.url.split("?")[0]));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p) || !p.startsWith(CALYX)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 380, height: 320 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("  [page error]", m.text()); });

  const url =
    `${base}/web/index.html?test=1&frames=${FRAMES}` +
    `&cart=/conformance/build/${CART}.wasm` +
    `&feed=/conformance/carts/${CART}/${CART}.in.json`;
  await page.goto(url);
  await page.waitForFunction("window.__calyx !== undefined", { timeout: 20000 });

  const calyx = await page.evaluate(() => window.__calyx);
  if (calyx.error) throw new Error("page: " + calyx.error);

  // (1) the runtime ran in-browser
  const runOk = calyx.run_hash === EXP.run_hash;
  console.log(`${runOk ? "PASS" : "FAIL"}  in-browser run_hash ${calyx.run_hash} ` +
    `${runOk ? "==" : "!="} oracle ${EXP.run_hash}`);
  ok = ok && runOk;

  // (2) the canvas pixels reconstruct the verified framebuffer
  const canvasHash = await page.evaluate((PAL) => {
    const key = (r, g, b) => (r << 16) | (g << 8) | b;
    const lut = new Map(PAL.map((c, i) => [key(c[0], c[1], c[2]), i]));
    const c = document.getElementById("screen");
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 320, 240).data;
    const MASK = (1n << 64n) - 1n;
    let h = 0xcbf29ce484222325n;
    const P = 0x100000001b3n;
    for (let i = 0; i < 320 * 240; i++) {
      const j = i * 4;
      const id = lut.get(key(d[j], d[j + 1], d[j + 2]));
      if (id === undefined) return "PALETTE_MISMATCH@" + i;
      h ^= BigInt(id);
      h = (h * P) & MASK;
    }
    return h.toString(16).padStart(16, "0");
  }, SWEETIE_16);
  const canvasOk = canvasHash === EXP.final_hash;
  console.log(`${canvasOk ? "PASS" : "FAIL"}  canvas-pixel hash ${canvasHash} ` +
    `${canvasOk ? "==" : "!="} oracle final_hash ${EXP.final_hash}`);
  ok = ok && canvasOk;

  await page.locator("#screen").screenshot({ path: join(WEB, "browser-shot.png") });
  console.log("  saved web/browser-shot.png");
} finally {
  await browser.close();
  server.close();
}

console.log(`\nsmoke: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
