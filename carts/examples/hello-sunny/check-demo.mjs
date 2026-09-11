import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cartDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(cartDir, "../../..");
const out = mkdtempSync(join(tmpdir(), "hello-sunny-check-"));

try {
  const run = spawnSync("cargo", [
    "run", "-q", "-p", "calyx-cli", "--", "run",
    "--cart", join(cartDir, "cart.wasm"),
    "--frames", "210",
    "--in", join(cartDir, "demo.in.json"),
    "--out", out,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const frames = readFileSync(join(out, "frames.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  const traces = frames.flatMap((entry) => entry.trace);
  const audioFrames = frames.filter((entry) => entry.audio.length > 0);

  assert.deepEqual(traces, [
    "hello-sunny ready x=160 y=120",
    "hello-sunny pulse=1 x=220 y=120",
    "hello-sunny reset x=160 y=120",
    "hello-sunny pulse=1 x=18 y=57",
    "hello-sunny reset x=160 y=120",
  ]);
  assert.deepEqual(audioFrames.map((entry) => entry.f), [31, 62, 180, 200]);
  assert.equal(frames.at(-1).f, 209);
  console.log("hello-sunny demo: PASS movement + pulse + reset + bounds + audio");
} finally {
  rmSync(out, { recursive: true, force: true });
}
