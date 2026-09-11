// Browser gate for an assembled stable or Side B player: root boot, offline
// warmup, channel identity/catalog policy, and production MIME types.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { drawingCart } from "./test-support/drawing-cart.mjs";

const WEB = dirname(fileURLToPath(import.meta.url));
const profileAt = process.argv.indexOf("--profile");
const PROFILE = profileAt < 0 ? "release" : process.argv[profileAt + 1];
if (!["release", "sideb"].includes(PROFILE)) throw new Error("--profile must be release or sideb");
const ROOT = join(dirname(WEB), "build", PROFILE, "web");
const ORIGINAL_STARTER = join(dirname(WEB), "build", "starter-check", "original-cart.wasm");
const CUSTOMIZED_STARTER = join(dirname(WEB), "build", "starter-check", "customized-cart.wasm");
if (!existsSync(join(ROOT, "release.json"))) throw new Error(`build ${PROFILE} profile first`);
if (!existsSync(ORIGINAL_STARTER) || !existsSync(CUSTOMIZED_STARTER)) {
  throw new Error("run the starter build/profile gate before product smoke");
}
const expectedChannel = PROFILE === "sideb" ? "sideb" : "stable";
const STARTER_ARCHIVE = "calyx-cart-starter-1.0.0-rc.1.zip";
const RELEASE_SLATE = [
  "hello-sunny",
  "Horizon Burn",
  "Micro AI War",
  "Seaway Dig",
  "Split-Flap Fortunes",
  "Sunny API Lab",
  "Wormtide",
].sort();
const MIME = {".html":"text/html", ".mjs":"text/javascript", ".js":"text/javascript", ".json":"application/json", ".webmanifest":"application/manifest+json", ".wasm":"application/wasm", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml"};

const u32 = (value) => {
  const out = [];
  do { let b = value & 0x7f; value >>>= 7; if (value) b |= 0x80; out.push(b); } while (value);
  return out;
};
const str = (value) => { const b = [...new TextEncoder().encode(value)]; return [...u32(b.length), ...b]; };
const sec = (id, body) => [id, ...u32(body.length), ...body];
function hungCart(hang) {
  const noop = [0, 0x0b];
  const spin = [0, 0x03, 0x40, 0x0c, 0, 0x0b, 0x0b];
  const bodies = hang === "instantiate"
    ? [spin, noop, noop]
    : [hang === "start" ? spin : noop, hang === "update" ? spin : noop];
  const startIndex = hang === "instantiate" ? 1 : 0;
  const updateIndex = hang === "instantiate" ? 2 : 1;
  const types = sec(1, [1, 0x60, 0, 0]);
  const functions = sec(3, [...u32(bodies.length), ...bodies.map(() => 0)]);
  const memory = sec(5, [1, 1, 1, ...u32(1024)]);
  const exports = sec(7, [3,
    ...str("start"), 0, ...u32(startIndex),
    ...str("update"), 0, ...u32(updateIndex),
    ...str("memory"), 2, 0,
  ]);
  const startSection = hang === "instantiate" ? sec(8, [0]) : [];
  const code = sec(10, [...u32(bodies.length), ...bodies.flatMap((body) => [...u32(body.length), ...body])]);
  return Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...functions, ...memory, ...exports, ...startSection, ...code]);
}
function faultCart() {
  const noop = [0, 0x0b];
  const trap = [0, 0x00, 0x0b];
  const bodies = [noop, trap];
  const types = sec(1, [1, 0x60, 0, 0]);
  const functions = sec(3, [2, 0, 0]);
  const memory = sec(5, [1, 1, 1, ...u32(1024)]);
  const exports = sec(7, [3,
    ...str("start"), 0, 0,
    ...str("update"), 0, 1,
    ...str("memory"), 2, 0,
  ]);
  const code = sec(10, [2, ...bodies.flatMap((body) => [...u32(body.length), ...body])]);
  return Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...functions, ...memory, ...exports, ...code]);
}
async function launchSideBHd(page) {
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowDown", "z"]) {
    await page.keyboard.press(key, {delay: 50});
    await page.waitForTimeout(60);
  }
}
const server = createServer((req, res) => {
  if (req.url.split("?")[0] === "/deployment.json") {
    const release = JSON.parse(readFileSync(join(ROOT, "release.json")));
    res.writeHead(200, {"content-type":"application/json", "cache-control":"no-cache"});
    return res.end(JSON.stringify({schema:1, channel:expectedChannel, payload_id:release.payload_id, deployed_at:"2026-07-15T12:00:00Z", note:"Product smoke provenance"}));
  }
  let path = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0])));
  if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404); return res.end(); }
  if (statSync(path).isDirectory()) path = join(path, "index.html");
  res.writeHead(200, {"content-type": MIME[extname(path)] || "application/octet-stream", "cache-control":"no-cache"});
  res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      value: true,
    });
  });
  const page = await context.newPage();
  await page.setViewportSize({width: 390, height: 844});
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher && window.__calyxProduct?.offlineReady, null, {timeout: 20000});
  if (await page.locator("body").evaluate((element) => getComputedStyle(element).paddingTop) !== "32px") {
    throw new Error("iOS standalone header clearance did not apply");
  }
  await page.setViewportSize({width: 844, height: 390});
  if (await page.locator("body").evaluate((element) => getComputedStyle(element).paddingTop) !== "10px") {
    throw new Error("iOS standalone header clearance remained active in landscape");
  }
  await page.setViewportSize({width: 390, height: 844});
  if (await page.evaluate(() => window.__calyxProduct.bootCount) !== 1) throw new Error("cold start did not run the boot cart exactly once");
  await page.locator("#boot-replay").click();
  await page.waitForFunction(() => window.__calyxProduct?.view === "boot" && window.__calyxProduct?.bootCount === 2, null, {timeout: 2000});
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 4000});
  const manifest = await (await page.request.get(`${origin}/manifest.webmanifest`)).json();
  const expectedName = PROFILE === "sideb" ? "Calyx Side B" : "Calyx";
  if (manifest.name !== expectedName || "orientation" in manifest) throw new Error("installed player identity or rotation policy regressed");
  if ((await page.title()) !== expectedName) throw new Error("browser title or channel identity regressed");
  if ((await page.locator("html").getAttribute("data-channel")) !== (PROFILE === "sideb" ? "sideb" : null)) throw new Error("document channel identity regressed");
  if (await page.locator("#install-button, #update-button, #install-help").count()) {
    throw new Error("removed install/update affordance is still present");
  }
  if (await page.locator(".brandcopy span").count()) throw new Error("umbrella credit returned to the persistent header");
  if (await page.locator("#help-button").innerText() !== "Help") throw new Error("player help action has stale Controls copy");
  const state = await page.evaluate(() => window.__calyxProduct);
  if (!state.payloadId || state.mode !== "console" || state.channel !== expectedChannel) throw new Error(`bad product state ${JSON.stringify(state)}`);
  // Hold across at least one 60 Hz sample; an instantaneous synthetic
  // down/up can legitimately fall between presenter frames.
  await page.keyboard.press("z", {delay: 50});
  await page.waitForFunction(() => window.__calyxProduct?.view === "cart", null, {timeout: 2000});
  await page.locator("#boot-replay").click();
  await page.waitForFunction(() => window.__calyxProduct?.view === "boot" && window.__calyxProduct?.bootCount === 3, null, {timeout: 2000});
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 4000});
  await page.locator("#help-button").click();
  await page.waitForSelector("#share-qr svg");
  await page.locator("#advanced-toggle").click();
  if (await page.locator("#advanced-panel").isHidden()) throw new Error("Advanced build metadata did not open");
  await page.locator("#perf-toggle").click();
  if (await page.locator("#perf-toggle").getAttribute("aria-pressed") !== "true") {
    throw new Error("performance overlay toggle did not enable presenter metrics");
  }
  await page.locator("#help-close").click();
  await page.waitForFunction(() => /^\d+\.\d\/(30|60)$/.test(document.querySelector("#perf-fps")?.textContent), null, { timeout: 2500 });
  if (await page.locator("#perf-overlay").isHidden()) throw new Error("performance overlay is not visible over the player");
  await page.locator("#help-button").click();
  await page.locator("#perf-toggle").click();
  if (!(await page.locator("#perf-overlay").isHidden())) throw new Error("performance overlay did not turn off");
  if (!(await page.locator("#build-source").innerText()).trim()) throw new Error("source provenance missing");
  if ((await page.locator("#build-payload").innerText()) !== state.payloadId) throw new Error("Advanced payload identity disagrees with runtime state");
  if ((await page.locator("#build-note").innerText()) !== "Product smoke provenance") throw new Error("deploy-time note missing");
  if (await page.locator("#share-link").getAttribute("href") !== `${origin}/`) throw new Error("share link is not the bare player URL");
  const qrScript = await page.request.get(`${origin}/node_modules/qrcode-generator/qrcode.js`);
  if (!qrScript.ok() || !qrScript.headers()["content-type"].startsWith("text/javascript")) throw new Error("local QR encoder missing from release payload");
  await page.locator("#help-close").click();
  const starterResponse = await page.request.get(`${origin}/downloads/${STARTER_ARCHIVE}`);
  const starterBytes = await starterResponse.body();
  const starterChecksum = await (await page.request.get(`${origin}/downloads/${STARTER_ARCHIVE}.sha256`)).text();
  const starterDigest = createHash("sha256").update(starterBytes).digest("hex");
  if (!starterResponse.ok() || !starterChecksum.startsWith(`${starterDigest}  ${STARTER_ARCHIVE}`)) {
    throw new Error("starter ZIP or checksum missing from hosted payload");
  }
  const catalog = await (await page.request.get(`${origin}/carts/carts.json`)).json();
  const cartNames = catalog.carts.map((cart) => cart.name).sort();
  const hasHelloSunny = cartNames.includes("hello-sunny");
  if (PROFILE === "release" && JSON.stringify(cartNames) !== JSON.stringify(RELEASE_SLATE)) {
    throw new Error(`release catalog disagrees with frozen slate: ${JSON.stringify(cartNames)}`);
  }
  if (PROFILE === "sideb" && (!hasHelloSunny || catalog.carts.length <= 4)) throw new Error("Side B catalog is not the inclusive dev catalog");
  const wasm = await page.request.get(`${origin}/${catalog.carts[0].wasm.replace(/^\.\//, "")}`);
  if (!wasm.headers()["content-type"].startsWith("application/wasm")) throw new Error("wrong Wasm MIME type");
  if (await page.locator("#play-local-button").innerText() !== "Upload") {
    throw new Error("local cart action is not the compact Upload affordance");
  }
  if (!(await page.locator("#help-button").evaluate(
    (element) => element.nextElementSibling?.id === "play-local-button",
  ))) {
    throw new Error("Upload is not positioned after Help");
  }
  await page.locator("#play-local-button").click();
  if (await page.locator("#upload-info-panel").isHidden()) {
    throw new Error("Upload did not explain local carts before opening a file picker");
  }
  if (!(await page.locator("#upload-info-description").innerText()).includes("stays on this device")) {
    throw new Error("Upload explanation omitted its local-only privacy boundary");
  }
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#upload-info-continue").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(ORIGINAL_STARTER);
  await page.waitForFunction(() => window.__calyxProduct?.view === "local-cart", null, {timeout: 5000});
  const originalFrame = createHash("sha256").update(await page.locator("#screen").screenshot()).digest("hex");
  await page.keyboard.press("Backspace");
  await page.locator("#confirm-accept").click();
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 3000});
  const localPath = CUSTOMIZED_STARTER;
  await page.locator("#local-cart-file").setInputFiles(localPath);
  await page.waitForFunction(() => window.__calyxProduct?.view === "local-cart", null, {timeout: 5000});
  const customizedFrame = createHash("sha256").update(await page.locator("#screen").screenshot()).digest("hex");
  if (customizedFrame === originalFrame) {
    throw new Error("editing the starter title did not visibly change the rendered frame");
  }
  if (!(await page.evaluate(() => window.__calyxProduct.cart)).includes("customized-cart.wasm")) {
    throw new Error("local cart filename was not shown for the live session");
  }
  await page.keyboard.press("ArrowRight", {delay: 50});
  await page.keyboard.press("Backspace");
  await page.locator("#confirm-accept").click();
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 3000});
  await page.locator("#local-cart-file").setInputFiles(localPath);
  await page.waitForFunction(() => window.__calyxProduct?.view === "local-cart", null, {timeout: 5000});
  await page.keyboard.press("Backspace");
  await page.locator("#confirm-accept").click();
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 3000});
  await page.locator("#local-cart-file").setInputFiles({
    name: "truecolor-classic.wasm", mimeType: "application/wasm", buffer: Buffer.from(drawingCart()),
  });
  await page.waitForFunction(() => window.__calyxProduct?.view === "local-cart", null, {timeout: 5000});
  await page.waitForFunction(() => {
    const canvas = document.querySelector("#screen");
    const pixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
    return canvas.width === 320 && canvas.height === 240 &&
      pixel[0] === 18 && pixel[1] === 52 && pixel[2] === 86 && pixel[3] === 255;
  }, null, {timeout: 5000});
  // Let recycled worker frames pass through, then verify the color remains intact.
  await page.waitForTimeout(100);
  const rgbaPixel = await page.evaluate(() => [...document.querySelector("#screen").getContext("2d").getImageData(319,239,1,1).data]);
  if (String(rgbaPixel) !== "18,52,86,255") throw new Error(`RGBA worker frame corrupted: ${rgbaPixel}`);
  await page.keyboard.press("Backspace");
  await page.locator("#confirm-accept").click();
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 3000});
  for (const phase of ["instantiate", "start", "update"]) {
    await page.locator("#local-cart-file").setInputFiles({
      name: `hung-${phase}.wasm`, mimeType: "application/wasm", buffer: hungCart(phase),
    });
    const expectedPhase = phase === "update" ? "first-frame" : phase;
    await page.waitForFunction(
      (expected) => !document.querySelector("#local-cart-error").hidden &&
        document.querySelector("#local-cart-error-message").textContent.includes(expected),
      expectedPhase,
      {timeout: 4000},
    );
    if (!(await page.locator("#local-cart-error-message").innerText()).includes("timed out")) {
      throw new Error(`hung ${phase} did not report a watchdog timeout`);
    }
    if (!(await page.evaluate(() => window.__calyxProduct.atLauncher))) {
      throw new Error(`hung ${phase} displaced the trusted launcher`);
    }
  }
  const reducedPage = await context.newPage();
  await reducedPage.emulateMedia({reducedMotion: "reduce"});
  await reducedPage.goto(`${origin}/`);
  await reducedPage.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 5000});
  if (await reducedPage.evaluate(() => window.__calyxProduct.bootCount) !== 0) throw new Error("reduced-motion client ran the animated boot cart");
  await reducedPage.close();
  const fallbackContext = await browser.newContext({serviceWorkers: "block"});
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.route("**/carts/boot/cart.wasm", (route) => route.fulfill({status: 500, body: "boot unavailable"}));
  await fallbackPage.goto(`${origin}/`);
  await fallbackPage.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 5000});
  await fallbackContext.close();
  if (PROFILE === "sideb") {
    const missingHdBootContext = await browser.newContext({serviceWorkers: "block"});
    const missingHdBootPage = await missingHdBootContext.newPage();
    await missingHdBootPage.route("**/carts/hd-boot/cart.wasm", (route) =>
      route.fulfill({status: 500, body: "HD boot unavailable"}),
    );
    await missingHdBootPage.goto(`${origin}/`);
    await missingHdBootPage.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 5000});
    await launchSideBHd(missingHdBootPage);
    await missingHdBootPage.waitForFunction(() =>
      window.__calyxProduct?.atLauncher && document.querySelector("#msg")?.textContent.startsWith("HD launch failed:"),
    null, {timeout: 5000});
    await missingHdBootContext.close();

    const hdFaultContext = await browser.newContext({serviceWorkers: "block"});
    const hdFaultPage = await hdFaultContext.newPage();
    await hdFaultPage.route("**/carts/hd-input-lab/cart.wasm", (route) =>
      route.fulfill({status: 200, contentType: "application/wasm", body: faultCart()}),
    );
    await hdFaultPage.goto(`${origin}/`);
    await hdFaultPage.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 5000});
    await launchSideBHd(hdFaultPage);
    await hdFaultPage.waitForFunction(() =>
      window.__calyxProduct?.atLauncher &&
        window.__calyxProduct?.inputProfile === "classic" &&
        document.body.dataset.display === "classic" &&
        document.querySelector("#msg")?.textContent.startsWith("HD failed at f"),
    null, {timeout: 7000});
    await hdFaultContext.close();
  }
  await context.setOffline(true);
  await page.reload({waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher, null, {timeout: 10000});
  const offlineStarterBytes = await page.evaluate(async (path) =>
    (await (await fetch(path)).arrayBuffer()).byteLength,
  `./downloads/${STARTER_ARCHIVE}`);
  if (offlineStarterBytes !== starterBytes.byteLength) {
    throw new Error("starter ZIP was not available from the verified offline payload");
  }
  await page.locator("#help-button").click();
  await page.waitForSelector("#share-qr svg");
  await page.locator("#advanced-toggle").click();
  if ((await page.locator("#build-deployed").innerText()) === "Unavailable") throw new Error("offline deployment provenance was not retained");
  const offlineStatus = await page.locator("#msg").innerText();
  if (offlineStatus.startsWith("PWA setup:")) throw new Error(offlineStatus);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`product smoke: PASS ${expectedChannel} ${state.payloadId}`);
} finally {
  await browser.close();
  server.close();
}
