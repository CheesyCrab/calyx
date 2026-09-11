// rand — the blessed PRNG (ABI §4a; Phase 1 recommendation promoted
// to v1). The ABI deliberately provides no host RNG: a cart owns its
// randomness so runs stay deterministic and runtimes bit-identical.
// This is the LCG the particles cart proved across both runtimes,
// promoted verbatim — seeded, integer-only, no float anywhere.

let _rng: u32 = 0x9e3779b9;

// Reseed; call from cart_ready() for a reproducible run.
export function seed(s: u32): void {
  _rng = s;
}

// Next raw 32-bit state (the classic 1664525/1013904223 LCG).
export function rand(): u32 {
  _rng = _rng * 1664525 + 1013904223;
  return _rng;
}

// Uniform-ish integer in [lo, hi) — CartBase carts' randi_range shape.
export function rand_range(lo: i32, hi: i32): i32 {
  return lo + <i32>(rand() % <u32>(hi - lo));
}

// Current state without advancing — cheap to trace as a determinism
// witness (frames.jsonl shows exactly where two runs diverge).
export function rand_state(): u32 {
  return _rng;
}

// Shuffle an i32 array in place. Empty and one-item arrays consume no RNG.
export function shuffle_i32(values: i32[]): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = rand_range(0, i + 1);
    const value = values[i];
    values[i] = values[j];
    values[j] = value;
  }
}
