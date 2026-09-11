// particles (v1 conformance cart) — a seeded-PRNG physics fountain,
// authored through Sunny (ROADMAP T5).
//
// The point of this cart is to be *hard to verify by eye*: 64 dots under
// gravity, bouncing with damping and a deterministic scatter, form a
// churning cloud. No human can glance at frame 137 and say "correct." Yet
// it is fully reproducible — integer-only math (no float, no wall-clock)
// driven by Sunny's blessed PRNG (the same LCG this cart originally
// proved) — so a single run_hash still pins the whole run, and a one-line
// physics bug is localized to the exact frame it first shows up.

import {
  run_start, run_update,
  frame, width, height,
  clear, px_rect, px_text, trace,
  a_held,
  seed, rand_range, rand_state, shuffle_i32,
  BLACK, WHITE,
  NAVY, BLUE, LIGHT_BLUE, CYAN, GREEN, LIGHT_GREEN, YELLOW, ORANGE, RED,
} from "../../../sdk/assembly/index";

const N: i32 = 64;
const SUB: i32 = 16;     // 4-bit fixed point (subpixels per pixel)
const GRAV: i32 = 6;     // downward accel, subpixels / frame^2

// Persisted cart state (wasm globals survive across update() calls).
let xs = new StaticArray<i32>(N);   // position, subpixels
let ys = new StaticArray<i32>(N);
let vxs = new StaticArray<i32>(N);  // velocity, subpixels / frame
let vys = new StaticArray<i32>(N);

function iabs(v: i32): i32 {
  return v < 0 ? -v : v;
}

// speed → heat color ramp
let RAMP: i32[] = [
  NAVY, BLUE, LIGHT_BLUE, CYAN, GREEN, LIGHT_GREEN, YELLOW, ORANGE, RED,
];
function heat(bucket: i32): i32 {
  if (bucket < 0) bucket = 0;
  if (bucket >= RAMP.length) bucket = RAMP.length - 1;
  return RAMP[bucket];
}

function cart_ready(): void {
  seed(0x12345678);
  const empty: i32[] = [];
  const singleton: i32[] = [7];
  shuffle_i32(empty);
  shuffle_i32(singleton);
  assert(rand_state() == 0x12345678);
  assert(singleton[0] == 7);

  const sample: i32[] = [0, 1, 2, 3, 4, 5, 6, 7];
  shuffle_i32(sample);
  const expected: i32[] = [2, 1, 4, 5, 0, 3, 6, 7];
  for (let i = 0; i < expected.length; i++) assert(sample[i] == expected[i]);
  assert(rand_state() == 3926884741);

  seed(0x9e3779b9); // fixed seed → reproducible cloud
  const w = width();
  const h = height();
  for (let i = 0; i < N; i++) {
    xs[i] = rand_range(0, w) * SUB;
    ys[i] = rand_range(0, h / 2) * SUB;
    vxs[i] = (rand_range(-2, 3) * SUB) / 4;
    vys[i] = rand_range(0, 2) * SUB;
  }
}

function cart_process(): void {
  const w = width();
  const h = height();
  const floor = (h - 1) * SUB;
  const right = (w - 1) * SUB;
  const fountain = a_held(); // hold A → push the whole cloud upward

  for (let i = 0; i < N; i++) {
    vys[i] += GRAV;
    if (fountain) vys[i] -= GRAV * 2; // gentle net updraft while A held

    xs[i] += vxs[i];
    ys[i] += vys[i];

    // closed box: bounce off floor AND ceiling so the cloud never escapes
    // and keeps bouncing → the scatter PRNG stays live → sustained chaos.
    if (ys[i] >= floor) {
      ys[i] = floor;
      vys[i] = -((vys[i] * 12) >> 4);            // 0.75 bounce damping
      vxs[i] += (rand_range(-1, 2) * SUB) / 8;   // deterministic scatter
    } else if (ys[i] < 0) {
      ys[i] = 0;
      vys[i] = -((vys[i] * 12) >> 4);
    }
    if (xs[i] < 0) {
      xs[i] = 0;
      vxs[i] = -vxs[i];
    } else if (xs[i] > right) {
      xs[i] = right;
      vxs[i] = -vxs[i];
    }
  }
}

function cart_draw(): void {
  clear(BLACK);

  for (let i = 0; i < N; i++) {
    const spd = (iabs(vxs[i]) + iabs(vys[i])) >> 5;
    px_rect(xs[i] >> 4, ys[i] >> 4, 2, 2, heat(spd));
  }

  px_text(4, 4, "PARTICLES", WHITE);
  px_text(4, 16, "A=FOUNTAIN", WHITE);

  // cart-chosen log: a cheap human-readable witness of internal state
  trace("f=" + frame().toString());
  trace("p0=" + (xs[0] >> 4).toString() + "," + (ys[0] >> 4).toString());
  trace("rng=" + rand_state().toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
