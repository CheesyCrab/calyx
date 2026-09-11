// Product touch/layout browser gate. Uses the assembled release tree so the
// test crosses the real launcher, runtime, and presenter boundary.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { selectTouchJourneys } from "./testing/touch-journeys.mjs";

const WEB = dirname(fileURLToPath(import.meta.url));
const profileAt = process.argv.indexOf("--profile");
const PROFILE = profileAt < 0 ? "release" : process.argv[profileAt + 1];
if (!["release", "sideb"].includes(PROFILE)) throw new Error("--profile must be release or sideb");
const ROOT = join(dirname(WEB), "build", PROFILE, "web");
const JOURNEY_SPECS = JSON.parse(readFileSync(join(WEB, "test", "touch-journeys.json"), "utf8"));
if (!existsSync(join(ROOT, "release.json"))) throw new Error(`build ${PROFILE} profile first`);
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let path = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0])));
  if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404); return res.end(); }
  if (statSync(path).isDirectory()) path = join(path, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function pointer(page, selector, type, pointerId, position = { x: .5, y: .5 }, fixedPoint = null) {
  const box = fixedPoint ? null : await page.locator(selector).boundingBox();
  if (!fixedPoint && !box) {
    const state = await page.evaluate(() => ({
      product: window.__calyxProduct,
      body: { ...document.body.dataset },
      touch: document.querySelector("#touch-controls")?.outerHTML.slice(0, 240),
    }));
    throw new Error(`${selector} has no box: ${JSON.stringify(state)}`);
  }
  const clientX = fixedPoint?.clientX ?? box.x + box.width * position.x;
  const clientY = fixedPoint?.clientY ?? box.y + box.height * position.y;
  await page.locator(type === "pointerdown" ? selector : "#touch-controls").dispatchEvent(type, {
    pointerId,
    pointerType: "touch",
    isPrimary: pointerId === 1,
    clientX,
    clientY,
    bubbles: true,
  });
  return { clientX, clientY };
}

const DPAD_POSITION = {
  up: { x: .5, y: .12 }, down: { x: .5, y: .88 },
  left: { x: .12, y: .5 }, right: { x: .88, y: .5 },
};

async function tap(page, name, pointerId) {
  const selector = DPAD_POSITION[name] ? ".touch-dpad" : `.touch-${name}`;
  const position = DPAD_POSITION[name] || { x: .5, y: .5 };
  const point = await pointer(page, selector, "pointerdown", pointerId, position);
  await page.waitForTimeout(70);
  await pointer(page, selector, "pointerup", pointerId, position, point);
  await page.waitForTimeout(70);
}

async function waitLayout(page, mode) {
  await page.waitForFunction((expected) => document.body.dataset.layout === expected, mode, { timeout: 3000 });
}

try {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value(duration) { window.__vibrations.push(duration); return true; },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.__calyxProduct?.atLauncher);
  if (await page.locator("#audio-toggle").innerText() !== "Sound ○") throw new Error("sound state indicator is ambiguous");
  if (await page.locator(".touch-start small").innerText() !== "MENU") throw new Error("touch Start semantic is not presented as Menu");
  if (await page.locator(".touch-home").getAttribute("aria-disabled") !== "true") throw new Error("touch Home should remain visible but disabled");
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
  if (!viewportMeta.includes("maximum-scale=1") || !viewportMeta.includes("user-scalable=no")) {
    throw new Error(`touch zoom guard missing: ${viewportMeta}`);
  }
  const interactionGuards = await page.evaluate(() => {
    const player = document.querySelector(".player");
    const action = document.querySelector(".touch-a");
    const actionLabel = document.querySelector(".touch-start small");
    const canceled = {};
    for (const type of ["touchstart", "touchmove", "selectstart", "contextmenu", "dragstart"]) {
      canceled[type] = !action.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
    const playerStyle = getComputedStyle(player);
    const actionStyle = getComputedStyle(action);
    const actionLabelStyle = getComputedStyle(actionLabel);
    return {
      canceled,
      playerSelect: playerStyle.userSelect,
      playerWebkitSelect: playerStyle.webkitUserSelect,
      actionSelect: actionStyle.userSelect,
      actionWebkitSelect: actionStyle.webkitUserSelect,
      actionLabelSelect: actionLabelStyle.userSelect,
      actionLabelWebkitSelect: actionLabelStyle.webkitUserSelect,
    };
  });
  if (Object.values(interactionGuards.canceled).some((value) => !value) ||
      interactionGuards.playerSelect !== "none" || interactionGuards.actionSelect !== "none" ||
      interactionGuards.actionLabelSelect !== "none" ||
      interactionGuards.playerWebkitSelect !== "none" || interactionGuards.actionWebkitSelect !== "none" ||
      interactionGuards.actionLabelWebkitSelect !== "none") {
    throw new Error(`console selection/callout guard missing: ${JSON.stringify(interactionGuards)}`);
  }
  const catalog = await (await page.request.get(`${origin}/carts/carts.json`)).json();
  const journeys = selectTouchJourneys(catalog, JOURNEY_SPECS, PROFILE);
  const preferredCategories = ["Games", "Stories", "Challenges", "Demos", "Settings"];
  const categories = [...new Set(catalog.carts.map((cart) => cart.category || "Games"))]
    .sort((a, b) => {
      const ar = preferredCategories.includes(a) ? preferredCategories.indexOf(a) : preferredCategories.length;
      const br = preferredCategories.includes(b) ? preferredCategories.indexOf(b) : preferredCategories.length;
      return ar === br ? (a < b ? -1 : a > b ? 1 : 0) : ar - br;
    });
  const launcherPath = (name) => {
    const target = catalog.carts.find((cart) => cart.name === name);
    if (!target) throw new Error(`${name}: touch journey has no release cart`);
    const category = target.category || "Games";
    const categoryIndex = categories.indexOf(category);
    const rowIndex = catalog.carts
      .filter((cart) => (cart.category || "Games") === category)
      .findIndex((cart) => cart.name === name);
    return [...Array(categoryIndex).fill("right"), ...Array(rowIndex).fill("down")];
  };
  const defaultCart = catalog.carts.find(
    (cart) => (cart.category || "Games") === categories[0],
  );

  const fixtures = [
    { width: 375, height: 667, safe: {} },
    { width: 390, height: 844, safe: { top: 47, bottom: 34 } },
    { width: 667, height: 375, safe: { left: 44, right: 44, bottom: 21 } },
    { width: 1024, height: 768, safe: {} },
  ];
  for (const fixture of fixtures) {
    await page.setViewportSize({ width: fixture.width, height: fixture.height });
    await waitLayout(page, fixture.width > fixture.height ? "landscape" : "portrait");
    await page.evaluate((safe) => {
      const style = document.documentElement.style;
      for (const side of ["top", "right", "bottom", "left"]) {
        style.setProperty(`--safe-${side}`, `${safe[side] || 0}px`);
      }
    }, fixture.safe);
    const layout = await page.evaluate(() => {
      const box = (element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        canvas: box(document.querySelector("canvas")),
        controls: box(document.querySelector("#touch-controls")),
        chrome: [...document.querySelectorAll(".toolbar, .statusline")]
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => ({ name: element.className, ...box(element) })),
        surfaces: [...document.querySelectorAll("[data-surface]")].map(box),
        utilities: [document.querySelector(".statusline"), document.querySelector(".toolbar")].map(box),
        overflow: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      };
    });
    if (layout.overflow.width > layout.viewport.width || layout.overflow.height > layout.viewport.height) {
      throw new Error(`${fixture.width}x${fixture.height}: document overflow ${JSON.stringify(layout.overflow)}`);
    }
    const ratio = layout.canvas.width / layout.canvas.height;
    if (Math.abs(ratio - 4 / 3) > .01) throw new Error(`${fixture.width}x${fixture.height}: canvas ratio ${ratio}`);
    for (const surface of layout.surfaces) {
      if (surface.width < 44 || surface.height < 44) throw new Error(`${fixture.width}x${fixture.height}: undersized target ${JSON.stringify(surface)}`);
      if (surface.left < (fixture.safe.left || 0) || surface.top < (fixture.safe.top || 0) ||
          surface.right > layout.viewport.width - (fixture.safe.right || 0) ||
          surface.bottom > layout.viewport.height - (fixture.safe.bottom || 0)) {
        throw new Error(`${fixture.width}x${fixture.height}: target outside viewport ${JSON.stringify(surface)}`);
      }
      if (overlaps(surface, layout.canvas)) throw new Error(`${fixture.width}x${fixture.height}: target overlaps framebuffer`);
    }
    if (fixture.width > fixture.height) {
      for (const utility of layout.utilities) {
        if (overlaps(utility, layout.canvas)) throw new Error(`${fixture.width}x${fixture.height}: utility footer still overlaps framebuffer`);
      }
    }
  }

  // Rotation passes through ambiguous near-square visual viewports on iOS.
  // Those frames must retain the previous layout, then commit portrait once.
  await page.setViewportSize({ width: 667, height: 375 });
  await waitLayout(page, "landscape");
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__layoutChanges = [];
    new MutationObserver(() => window.__layoutChanges.push(document.body.dataset.layout))
      .observe(document.body, { attributes: true, attributeFilter: ["data-layout"] });
  });
  const rotationActionWidths = [];
  for (const viewport of [{ width: 520, height: 500 }, { width: 500, height: 520 }, { width: 518, height: 500 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(60);
    if (await page.locator("body").getAttribute("data-layout") !== "landscape") throw new Error("near-square rotation frame changed layout");
    rotationActionWidths.push(await page.locator(".touch-actions").evaluate((element) => element.getBoundingClientRect().width));
  }
  if (Math.max(...rotationActionWidths) - Math.min(...rotationActionWidths) > .5) {
    throw new Error(`rotation resized controls before layout commit: ${JSON.stringify(rotationActionWidths)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await waitLayout(page, "portrait");
  const rotationChanges = await page.evaluate(() => window.__layoutChanges);
  if (rotationChanges.length !== 1 || rotationChanges[0] !== "portrait") {
    throw new Error(`rotation layout thrashed: ${JSON.stringify(rotationChanges)}`);
  }

  if (process.env.CALYX_TOUCH_LANDSCAPE_SCREENSHOT) {
    await page.setViewportSize({ width: 844, height: 390 });
    await waitLayout(page, "landscape");
    await page.evaluate(() => {
      for (const side of ["top", "right", "bottom", "left"]) document.documentElement.style.setProperty(`--safe-${side}`, "0px");
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: process.env.CALYX_TOUCH_LANDSCAPE_SCREENSHOT, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await waitLayout(page, "portrait");
  await page.evaluate(() => {
    for (const side of ["top", "right", "bottom", "left"]) document.documentElement.style.setProperty(`--safe-${side}`, "0px");
  });
  await page.waitForTimeout(100);
  if (process.env.CALYX_TOUCH_SCREENSHOT) {
    await page.screenshot({ path: process.env.CALYX_TOUCH_SCREENSHOT, fullPage: true });
  }
  await pointer(page, ".touch-a", "pointerdown", 1);
  await page.waitForFunction(() => window.__vibrations.length > 0);
  if (await page.evaluate(() => window.__vibrations.at(-1)) !== 24) throw new Error("touch haptic pulse is missing or too weak");
  await new Promise((resolve) => setTimeout(resolve, 80));
  await pointer(page, ".touch-a", "pointerup", 1);
  await page.waitForFunction(() => !window.__calyxProduct.atLauncher, null, { timeout: 5000 });
  if (await page.evaluate(() => window.__calyxProduct.cart) !== defaultCart.name) {
    throw new Error(`default touch launch did not open ${defaultCart.name}`);
  }
  if (await page.locator(".touch-home").getAttribute("aria-disabled") !== "false") throw new Error("touch Home did not enable in place");

  await pointer(page, ".touch-dpad", "pointerdown", 2, { x: .82, y: .18 });
  await pointer(page, ".touch-a", "pointerdown", 3);
  await page.waitForFunction(() => window.__calyxProduct.touchMask === ((1 << 0) | (1 << 3) | (1 << 4)), null, { timeout: 5000 });
  if (await page.locator(".dpad-up.is-pressed, .dpad-right.is-pressed, .touch-a.is-pressed").count() !== 3) {
    throw new Error("pressed-state feedback did not match the held chord");
  }
  const trails = await page.locator(".touch-trail").count();
  if (trails < 2 || trails > 32) throw new Error(`feedback trail count ${trails}`);
  if (await page.evaluate(() => window.__calyxProduct.inputMethod) !== 2) throw new Error("touch did not become the meaningful input method");
  await pointer(page, ".touch-a", "pointerup", 3);
  await pointer(page, ".touch-dpad", "pointerup", 2);
  await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 5000 });
  if (await page.locator(".is-pressed").count()) throw new Error("pressed feedback stuck after release");

  await pointer(page, ".touch-b", "pointerdown", 30);
  await page.waitForFunction(() => window.__calyxProduct.touchMask === (1 << 5), null, { timeout: 5000 });
  await page.locator("body").dispatchEvent("pointerup", {
    pointerId: 30,
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
    bubbles: true,
  });
  await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 5000 });
  if (await page.locator(".is-pressed").count()) throw new Error("pressed feedback stuck after outside release");

  await pointer(page, ".touch-a", "pointerdown", 31);
  await page.waitForFunction(() => window.__calyxProduct.touchMask === (1 << 4), null, { timeout: 5000 });
  await page.locator(".touch-a").dispatchEvent("contextmenu", { bubbles: true, cancelable: true });
  await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 5000 });
  if (await page.locator(".is-pressed").count()) throw new Error("pressed feedback stuck after native interruption");

  await page.waitForTimeout(450);
  if (await page.locator(".touch-trail").count()) throw new Error("feedback trail did not expire within 450ms");

  await pointer(page, ".touch-start", "pointerdown", 4);
  await pointer(page, ".touch-start", "pointerup", 4);
  await pointer(page, ".touch-home", "pointerdown", 5);
  await page.waitForFunction(() => window.__calyxProduct.confirmation === "home", null, { timeout: 5000 });
  const homePrompt = await page.locator("#confirm-panel .confirm-card").boundingBox();
  const gameViewport = await page.locator("#screen").boundingBox();
  if (!homePrompt || !gameViewport || homePrompt.y < gameViewport.y ||
      homePrompt.y + homePrompt.height > gameViewport.y + gameViewport.height) {
    throw new Error("Home confirmation is not anchored inside the game viewport");
  }
  if (!(await page.locator("#confirm-cancel").evaluate((element) => element === document.activeElement))) {
    throw new Error("destructive confirmation did not focus Cancel first");
  }
  await tap(page, "right", 6);
  if (!(await page.locator("#confirm-cancel").evaluate((element) => element === document.activeElement))) {
    throw new Error("Home-opening touch escaped the confirmation input lock");
  }
  await page.waitForTimeout(100);
  await tap(page, "right", 7);
  if (!(await page.locator("#confirm-accept").evaluate((element) => element === document.activeElement))) {
    throw new Error("touch D-pad did not select Confirm after the input lock");
  }
  await tap(page, "left", 8);
  if (!(await page.locator("#confirm-cancel").evaluate((element) => element === document.activeElement))) {
    throw new Error("touch D-pad did not return to Cancel");
  }
  await tap(page, "b", 9);
  if (await page.evaluate(() => window.__calyxProduct.atLauncher)) throw new Error("touch B cancellation discarded the cart");
  if (await page.evaluate(() => window.__calyxProduct.confirmation)) throw new Error("touch B did not close Home confirmation");
  await pointer(page, ".touch-home", "pointerdown", 6);
  await page.waitForTimeout(220);
  await tap(page, "right", 10);
  await tap(page, "a", 11);
  await page.waitForFunction(() => window.__calyxProduct.atLauncher, null, { timeout: 5000 });

  let pointerId = 20;
  for (const journey of journeys) {
    for (const direction of launcherPath(journey.name)) await tap(page, direction, pointerId++);
    await tap(page, "a", pointerId++);
    await page.waitForFunction((name) => !window.__calyxProduct.atLauncher && window.__calyxProduct.cart === name, journey.name, { timeout: 5000 });
    await tap(page, journey.play, pointerId++);
    if (await page.evaluate(() => window.__calyxProduct.inputMethod) !== 2) throw new Error(`${journey.name}: play input was not TOUCH`);
    await pointer(page, ".touch-home", "pointerdown", pointerId++);
    await page.waitForFunction(() => window.__calyxProduct.confirmation === "home", null, { timeout: 5000 });
    await page.locator("#confirm-accept").click();
    await page.waitForFunction(() => window.__calyxProduct.atLauncher, null, { timeout: 5000 });
  }

  if (PROFILE === "sideb") {
    const hdName = "Calyx Resonator";
    const hdCart = catalog.carts.find((cart) => cart.name === hdName);
    if (!hdCart || hdCart.display !== "hd" || hdCart.input !== "extended") {
      throw new Error(`${hdName}: Side B HD/extended witness is missing or misprofiled`);
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await waitLayout(page, "landscape");
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty("--safe-left", "44px");
      style.setProperty("--safe-right", "44px");
      style.setProperty("--safe-bottom", "21px");
      style.setProperty("--safe-top", "0px");
    });
    await page.locator("#help-button").click();
    await page.locator("#advanced-toggle").click();
    await page.locator("#perf-toggle").click();
    await page.locator("#help-close").click();
    for (const direction of launcherPath(hdName)) await tap(page, direction, pointerId++);
    await tap(page, "a", pointerId++);
    await page.waitForFunction(
      () => document.body.dataset.display === "hd" && window.__calyxProduct.inputProfile === "classic",
      null,
      { timeout: 5000 },
    );
    if (await page.locator("#touch-controls").getAttribute("data-input") !== "classic") {
      throw new Error("HD boot exposed the extended deck before the target started");
    }
    await page.waitForFunction(
      (name) => window.__calyxProduct.cart === name && window.__calyxProduct.inputProfile === "extended",
      hdName,
      { timeout: 5000 },
    );
    if (await page.locator("#touch-controls").getAttribute("data-input") !== "extended") {
      throw new Error("HD target did not swap to its extended touch deck");
    }
    await page.waitForFunction(() => /^\d+\.\d\/30$/.test(document.querySelector("#perf-fps")?.textContent), null, { timeout: 2500 });

    const hdLayout = await page.evaluate(() => {
      const box = (element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        canvas: box(document.querySelector("canvas")),
        controls: box(document.querySelector("#touch-controls")),
        perf: box(document.querySelector("#perf-overlay")),
        surfaces: [...document.querySelectorAll("#touch-controls [data-surface], #touch-controls [data-shell]")]
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => ({ name: element.dataset.surface || element.dataset.shell, ...box(element) })),
        overflow: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        overflowers: [...document.querySelectorAll("body *")]
          .map((element) => ({ element: element.className || element.id || element.tagName, ...box(element) }))
          .filter((entry) => entry.left < 0 || entry.right > innerWidth)
          .slice(0, 12),
      };
    });
    if (Math.abs(hdLayout.canvas.width / hdLayout.canvas.height - 16 / 9) > .01) {
      throw new Error(`HD canvas ratio regressed: ${JSON.stringify(hdLayout.canvas)}`);
    }
    if (hdLayout.surfaces.length !== 9) {
      throw new Error(`extended deck expected 8 cart surfaces plus Home, got ${JSON.stringify(hdLayout.surfaces)}`);
    }
    if (hdLayout.overflow.width > hdLayout.viewport.width || hdLayout.overflow.height > hdLayout.viewport.height) {
      throw new Error(`HD landscape overflow: ${JSON.stringify(hdLayout.overflow)}`);
    }
    if (await page.locator(".toolbar").isVisible()) {
      throw new Error("HD landscape utility toolbar overlaps the extended deck");
    }
    if (hdLayout.perf.top < hdLayout.canvas.bottom || hdLayout.perf.left < hdLayout.canvas.left ||
        hdLayout.perf.right > hdLayout.canvas.right) {
      throw new Error(`HD landscape performance bar is not below the framebuffer: ${JSON.stringify({ perf: hdLayout.perf, canvas: hdLayout.canvas })}`);
    }
    for (const surface of hdLayout.surfaces) {
      if (surface.width < 44 || surface.height < 44) {
        throw new Error(`HD undersized target: ${JSON.stringify(surface)}`);
      }
      if (overlaps(surface, hdLayout.canvas)) {
        throw new Error(`HD landscape target overlaps framebuffer: ${JSON.stringify({ surface, canvas: hdLayout.canvas, controls: hdLayout.controls })}`);
      }
      if (surface.left < 0 || surface.right > hdLayout.viewport.width ||
          surface.top < 0 || surface.bottom > hdLayout.viewport.height) {
        throw new Error(`HD landscape target escaped viewport: ${JSON.stringify({ surface, viewport: hdLayout.viewport })}`);
      }
    }

    for (const [name, bit] of [["x", 7], ["y", 8], ["l", 9], ["r", 10]]) {
      const point = await pointer(page, `.touch-${name}`, "pointerdown", pointerId++);
      try {
        await page.waitForFunction((mask) => window.__calyxProduct.touchMask === mask, 1 << bit, { timeout: 2000 });
      } catch (error) {
        const diagnostic = await page.evaluate(({ clientX, clientY }) => ({
          mask: window.__calyxProduct.touchMask,
          point: { clientX, clientY },
          containing: [...document.querySelectorAll("#touch-controls [data-surface]")]
            .filter((element) => {
              const r = element.getBoundingClientRect();
              return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
            })
            .map((element) => {
              const r = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return { surface: element.dataset.surface, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, position: style.position, top: style.top, right: style.right, bottom: style.bottom, left: style.left };
            }),
          body: { className: document.body.className, input: document.body.dataset.input, layout: document.body.dataset.layout },
        }), point);
        throw new Error(`HD ${name} pointer missed: ${JSON.stringify(diagnostic)}`, { cause: error });
      }
      await pointer(page, `.touch-${name}`, "pointerup", pointerId - 1);
      await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 2000 });
    }
    const xPointer = pointerId++;
    const lPointer = pointerId++;
    await pointer(page, ".touch-x", "pointerdown", xPointer);
    await pointer(page, ".touch-l", "pointerdown", lPointer);
    await page.waitForFunction(
      (mask) => window.__calyxProduct.touchMask === mask,
      (1 << 7) | (1 << 9),
      { timeout: 2000 },
    );
    await pointer(page, ".touch-x", "pointerup", xPointer);
    await pointer(page, ".touch-l", "pointerup", lPointer);
    await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 2000 });

    await page.waitForTimeout(1900);
    const restingOpacity = Number(await page.locator("#touch-controls").evaluate(
      (element) => getComputedStyle(element).opacity,
    ));
    if (restingOpacity > .5) throw new Error(`extended deck did not settle: ${restingOpacity}`);
    const wakePointer = pointerId++;
    await pointer(page, ".touch-a", "pointerdown", wakePointer);
    await page.waitForTimeout(220);
    const awakeOpacity = Number(await page.locator("#touch-controls").evaluate(
      (element) => getComputedStyle(element).opacity,
    ));
    if (awakeOpacity < .75) throw new Error(`extended deck did not wake: ${awakeOpacity}`);
    await pointer(page, ".touch-a", "pointerup", wakePointer);

    if (process.env.CALYX_HD_TOUCH_LANDSCAPE_SCREENSHOT) {
      await page.screenshot({ path: process.env.CALYX_HD_TOUCH_LANDSCAPE_SCREENSHOT });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty("--safe-left", "0px");
      style.setProperty("--safe-right", "0px");
      style.setProperty("--safe-top", "0px");
      style.setProperty("--safe-bottom", "21px");
    });
    await waitLayout(page, "portrait");
    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas").getBoundingClientRect();
      const controls = document.querySelector("#touch-controls").getBoundingClientRect();
      return controls.top >= canvas.bottom && controls.height >= 176;
    }, null, { timeout: 2000 });
    await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 2000 });
    const portraitLayout = await page.evaluate(() => {
      const box = (element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        canvas: box(document.querySelector("canvas")),
        controls: box(document.querySelector("#touch-controls")),
        chrome: [...document.querySelectorAll(".toolbar, .statusline")]
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => ({ name: element.className, ...box(element) })),
        surfaces: [...document.querySelectorAll("#touch-controls [data-surface], #touch-controls [data-shell]")]
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => ({ name: element.dataset.surface || element.dataset.shell, ...box(element) })),
        overflow: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        overflowers: [...document.querySelectorAll("body *")]
          .map((element) => ({ element: element.className || element.id || element.tagName, ...box(element) }))
          .filter((entry) => entry.left < 0 || entry.right > innerWidth)
          .slice(0, 12),
      };
    });
    if (portraitLayout.surfaces.length !== 9) {
      throw new Error(`HD portrait expected full deck, got ${JSON.stringify(portraitLayout.surfaces)}`);
    }
    if (portraitLayout.overflow.width > portraitLayout.viewport.width || portraitLayout.overflow.height > portraitLayout.viewport.height) {
      throw new Error(`HD portrait overflow: ${JSON.stringify({ overflow: portraitLayout.overflow, overflowers: portraitLayout.overflowers })}`);
    }
    for (const surface of portraitLayout.surfaces) {
      if (surface.width < 44 || surface.height < 44) {
        throw new Error(`HD portrait undersized target: ${JSON.stringify(surface)}`);
      }
      if (overlaps(surface, portraitLayout.canvas)) {
        throw new Error(`HD portrait target overlaps framebuffer: ${JSON.stringify({ surface, canvas: portraitLayout.canvas })}`);
      }
      for (const chrome of portraitLayout.chrome) {
        if (overlaps(surface, chrome)) {
          throw new Error(`HD portrait target overlaps product chrome: ${JSON.stringify({ surface, chrome })}`);
        }
      }
      if (surface.left < 0 || surface.right > portraitLayout.viewport.width ||
          surface.top < 0 || surface.bottom > portraitLayout.viewport.height) {
        throw new Error(`HD portrait target escaped viewport: ${JSON.stringify({ surface, viewport: portraitLayout.viewport })}`);
      }
    }
    const portraitXPointer = pointerId++;
    await pointer(page, ".touch-x", "pointerdown", portraitXPointer);
    await page.waitForFunction((mask) => window.__calyxProduct.touchMask === mask, 1 << 7, { timeout: 2000 });
    await pointer(page, ".touch-x", "pointerup", portraitXPointer);
    await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 2000 });
    if (process.env.CALYX_HD_TOUCH_PORTRAIT_SCREENSHOT) {
      await page.screenshot({ path: process.env.CALYX_HD_TOUCH_PORTRAIT_SCREENSHOT });
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await waitLayout(page, "landscape");
    await page.waitForFunction(() => window.__calyxProduct.touchMask === 0, null, { timeout: 2000 });
    await pointer(page, ".touch-home", "pointerdown", pointerId++);
    await page.waitForFunction(() => window.__calyxProduct.confirmation === "home", null, { timeout: 5000 });
    await page.locator("#confirm-accept").click();
    await page.waitForFunction(
      () => window.__calyxProduct.atLauncher &&
        window.__calyxProduct.inputProfile === "classic" &&
        document.body.dataset.display === "classic" &&
        window.__calyxProduct.touchMask === 0,
      null,
      { timeout: 5000 },
    );
    if (await page.locator("#touch-controls").getAttribute("data-input") !== "classic") {
      throw new Error("Home did not restore the Classic touch deck");
    }
    // HD resolution and Classic input are independent: this cart must be
    // navigable by touch without requiring the extended input profile.
    const classicHdName = "Sunny API Lab HD";
    for (const direction of launcherPath(classicHdName)) await tap(page, direction, pointerId++);
    await tap(page, "a", pointerId++);
    await page.waitForFunction((name) => window.__calyxProduct.cart === name &&
      window.__calyxProduct.view === "cart", classicHdName, { timeout: 5000 });
    for (const viewport of [{width:844,height:390},{width:390,height:844},{width:667,height:375}]) {
      await page.setViewportSize(viewport);
      await waitLayout(page, viewport.width > viewport.height ? "landscape" : "portrait");
      await page.waitForTimeout(250);
      const layout = await page.evaluate(() => {
        const box = (el) => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
        return {
          input: window.__calyxProduct.inputProfile,
          display: getComputedStyle(document.querySelector("#touch-controls")).display,
          canvas: box(document.querySelector("canvas")),
          surfaces: [...document.querySelectorAll("#touch-controls [data-surface], #touch-controls [data-shell]")]
            .map(el=>({name:el.dataset.surface||el.dataset.shell,...box(el)})),
          width:innerWidth,height:innerHeight,
          scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
        };
      });
      if (layout.input !== "classic" || layout.display === "none" || layout.surfaces.length !== 5)
        throw new Error(`HD Classic touch deck missing: ${JSON.stringify(layout)}`);
      for(const surface of layout.surfaces) {
        if(surface.width<44 || surface.height<44 || overlaps(surface,layout.canvas) ||
          surface.left<0 || surface.right>layout.width || surface.top<0 || surface.bottom>layout.height)
          throw new Error(`HD Classic touch target invalid: ${JSON.stringify({surface,layout})}`);
      }
      if(layout.scrollWidth>layout.width || layout.scrollHeight>layout.height)
        throw new Error(`HD Classic touch layout overflows: ${JSON.stringify(layout)}`);
      const before = await page.locator("canvas").evaluate(el=>el.toDataURL());
      await tap(page,"right",pointerId++);
      await page.waitForFunction(old=>document.querySelector("canvas").toDataURL()!==old,before);
      const beforeAction = await page.locator("canvas").evaluate(el=>el.toDataURL());
      await tap(page,"a",pointerId++);
      await page.waitForFunction(old=>document.querySelector("canvas").toDataURL()!==old,beforeAction);
      if(process.env.CALYX_HD_CLASSIC_TOUCH_SCREENSHOT_DIR)
        await page.screenshot({path:`${process.env.CALYX_HD_CLASSIC_TOUCH_SCREENSHOT_DIR}/hd-classic-${viewport.width}x${viewport.height}.png`});
    }
    await tap(page,"home",pointerId++);
    await page.waitForFunction(()=>window.__calyxProduct.confirmation==="home");
    await page.locator("#confirm-accept").click();
    await page.waitForFunction(()=>window.__calyxProduct.atLauncher && window.__calyxProduct.inputProfile==="classic");
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`touch smoke: PASS portrait + side-gutter landscape + runtime input${PROFILE === "sideb" ? " + HD extended and Classic-input lifecycles" : ""}`);
  await context.close();
} finally {
  await browser.close();
  server.close();
}
