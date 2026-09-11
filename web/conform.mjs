// Node conformance runner — grade the web runtime against the same oracle
// the native core passes (ROADMAP T6). The grading rules are the conformance
// README's "How a runtime passes"; the gate is cross-runtime parity: every
// blessed hash the web runtime fails to reproduce is a real divergence.
//
//   node conform.mjs [--suite <dir>]
//
// Exits nonzero on any FAIL (or if nothing was gradable).

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "./src/runtime.mjs";
import { parseCarts, parseFeed, parseInputMethods } from "./src/input.mjs";

const RUNTIME_DIALECT = "v1";
const HERE = dirname(fileURLToPath(import.meta.url));

function suiteDir() {
  const i = process.argv.indexOf("--suite");
  return i >= 0 ? process.argv[i + 1] : join(HERE, "..", "conformance");
}

// Minimal TOML reader for the cart.toml subset: [section] headers plus
// `key = "string"` / `key = integer`. No arrays, no nesting beyond sections.
function parseToml(text) {
  const out = {};
  let section = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1];
      out[section] = out[section] || {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv || section === null) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else if (/^-?\d+$/.test(v)) v = Number(v);
    out[section][kv[1]] = v;
  }
  return out;
}

function readManifest(dir) {
  const t = parseToml(readFileSync(join(dir, "cart.toml"), "utf8"));
  return {
    name: t.cart?.name,
    abi: t.cart?.abi ?? "v1",
    system: t.cart?.system === "true" || t.cart?.system === true,
    frames: t.run?.frames,
    width: t.run?.width ?? 320,
    height: t.run?.height ?? 240,
    feed: t.run?.feed,
    minDistinct: t.witness?.min_distinct_frame_hashes ?? 0,
    expected: t.expected
      ? { run_hash: t.expected.run_hash, final_hash: t.expected.final_hash, palette: t.expected.palette, color: t.expected.color }
      : null,
    expectedFault: t.fault ? { frame: t.fault.frame ?? 0, kind: t.fault.kind ?? "trap" } : null,
    dir,
  };
}

function loadSuite(suite) {
  const carts = join(suite, "carts");
  return readdirSync(carts)
    .map((n) => join(carts, n))
    .filter((d) => existsSync(join(d, "cart.toml")))
    .sort()
    .map(readManifest);
}

function ensureBuilt(suite, manifests) {
  // Product fixtures may import sources outside their fixture directory, so
  // include all fixture, product-cart, and Sunny TypeScript in staleness.
  function newestTs(root) {
    if (!existsSync(root)) return 0;
    const st = statSync(root);
    if (st.isFile()) return root.endsWith(".ts") ? st.mtimeMs : 0;
    let newest = 0;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      newest = Math.max(newest, newestTs(join(root, entry.name)));
    }
    return newest;
  }
  const root = dirname(suite);
  const newest = Math.max(
    newestTs(join(suite, "carts")),
    newestTs(join(root, "carts")),
    newestTs(join(root, "sdk", "assembly")),
  );
  const stale = manifests.some((m) => {
    const wasm = join(suite, "build", `${m.name}.wasm`);
    return !existsSync(wasm) || statSync(wasm).mtimeMs < newest;
  });
  if (!stale) return;
  execFileSync("python3", ["check.py", "build"], { cwd: suite, stdio: "inherit" });
}

function normAudio(arr) {
  return (arr || []).map((e) => `${e.op}:${e.freq}:${e.dur}:${e.vol}:${e.flags}`).join(",");
}

function normSys(arr) {
  return (arr || []).map((e) => (e.op === "launch" ? `launch:${e.i}` : e.op)).join(",");
}

function eventMap(report) {
  const m = new Map();
  for (const rec of report.frames) {
    if (rec.audio.length || (rec.sys && rec.sys.length)) {
      m.set(rec.f, `${normAudio(rec.audio)}|${normSys(rec.sys)}`);
    }
  }
  return m;
}

function eventsGolden(dir) {
  const path = join(dir, "events.golden.jsonl");
  const m = new Map();
  if (!existsSync(path)) return m;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    m.set(v.f, `${normAudio(v.audio)}|${normSys(v.sys)}`);
  }
  return m;
}

function grade(report, m, exp) {
  const fails = [];
  if (report.fault) fails.push(`run faulted at f${report.fault.f}: ${report.fault.kind} (${report.fault.msg})`);
  if (report.run_hash !== exp.run_hash) fails.push(`run_hash: want ${exp.run_hash} got ${report.run_hash}`);
  if (report.final_hash !== exp.final_hash) fails.push(`final_hash: want ${exp.final_hash} got ${report.final_hash}`);
  if (report.color !== exp.color) fails.push(`color: want ${exp.color} got ${report.color}`);
  if (report.palette_id !== exp.palette) fails.push(`palette: want ${exp.palette} got ${report.palette_id}`);
  const distinct = new Set(report.frames.map((r) => r.hash)).size;
  if (distinct < m.minDistinct) fails.push(`vacuous golden: ${distinct} distinct < witness ${m.minDistinct}`);

  const want = eventsGolden(m.dir);
  if (want.size) {
    const got = eventMap(report);
    for (const [f, ev] of want) if (got.get(f) !== ev) fails.push(`events @f${f}: want [${ev}] got [${got.get(f) || ""}]`);
    for (const [f, ev] of got) if (!want.has(f)) fails.push(`events @f${f}: expected silence, got [${ev}]`);
  }
  return fails;
}

function firstDivergence(report, dir) {
  const path = join(dir, "frames.golden.jsonl");
  if (!existsSync(path)) return;
  const golden = readFileSync(path, "utf8").split("\n").filter(Boolean);
  for (let i = 0; i < report.frames.length && i < golden.length; i++) {
    const want = JSON.parse(golden[i]).hash;
    if (report.frames[i].hash !== want) {
      console.log(`        first divergence at frame ${report.frames[i].f}: want ${want} got ${report.frames[i].hash} trace=${JSON.stringify(report.frames[i].trace)}`);
      return;
    }
  }
}

async function main() {
  const suite = suiteDir();
  const manifests = loadSuite(suite);
  ensureBuilt(suite, manifests);

  let passed = 0, failed = 0, skipped = 0;
  for (const m of manifests) {
    if (m.abi !== RUNTIME_DIALECT) {
      console.log(`SKIP  ${m.name}: dialect ${m.abi} != runtime's ${RUNTIME_DIALECT}`);
      skipped++;
      continue;
    }
    const wasm = readFileSync(join(suite, "build", `${m.name}.wasm`));
    let at = () => 0;
    let inputMethodAt = () => 0;
    let carts = [];
    let label = "(none)";
    if (m.feed) {
      const feedJson = JSON.parse(readFileSync(join(m.dir, m.feed), "utf8"));
      at = parseFeed(feedJson);
      inputMethodAt = parseInputMethods(feedJson);
      carts = parseCarts(feedJson);
      label = m.feed;
    }
    const runCfg = {
      frames: m.frames,
      w: m.width,
      h: m.height,
      at,
      inputMethodAt,
      inputLabel: label,
      system: m.system,
      carts,
    };

    // Carts expected to fault (ABI §6a) are graded on the fault record.
    // Kind "load" is the §4b privilege gate: instantiation must fail.
    if (m.expectedFault) {
      const { frame, kind } = m.expectedFault;
      if (kind === "load") {
        try {
          await run(new Uint8Array(wasm), runCfg, m.name);
          console.log(`FAIL  ${m.name}`);
          console.log("        expected a load error, cart instantiated fine");
          failed++;
        } catch (e) {
          console.log(`PASS  ${m.name}  refused to load (as expected: ${e.message})`);
          passed++;
        }
        continue;
      }
      const report = await run(new Uint8Array(wasm), runCfg, m.name);
      const f = report.fault;
      if (f && f.kind === kind && f.f === frame) {
        console.log(`PASS  ${m.name}  faulted ${f.kind} @f${f.f} (as expected)`);
        passed++;
      } else {
        console.log(`FAIL  ${m.name}`);
        console.log(f ? `        want fault ${kind} @f${frame}, got ${f.kind} @f${f.f}`
                      : `        expected a ${kind} fault @f${frame}, run completed clean`);
        failed++;
      }
      continue;
    }

    if (!m.expected) {
      console.log(`SKIP  ${m.name}: pending bless (no [expected])`);
      skipped++;
      continue;
    }
    const report = await run(new Uint8Array(wasm), runCfg, m.name);

    const fails = grade(report, m, m.expected);
    if (fails.length === 0) {
      console.log(`PASS  ${m.name}  run_hash ${report.run_hash} (${report.frames_run} frames)`);
      passed++;
    } else {
      console.log(`FAIL  ${m.name}`);
      for (const f of fails) console.log(`        ${f}`);
      firstDivergence(report, m.dir);
      failed++;
    }
  }

  console.log(`\nweb: ${passed} pass, ${failed} fail, ${skipped} skip`);
  if (failed > 0 || passed === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
