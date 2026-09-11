// FNV-1a 64-bit — the pinned Calyx hash (ABI §6a / §7).
//
// Same constants and byte order as the native core, reached independently
// from the spec (the two runtimes share the ABI, never code). BigInt gives
// exact u64 arithmetic; `run_hash` folds each frame hash as 8 little-endian
// bytes, everything renders as 16 lowercase hex chars.

const MASK = (1n << 64n) - 1n;
export const FNV_OFFSET = 0xcbf29ce484222325n;
export const FNV_PRIME = 0x100000001b3n;

export function fnvWrite(h, bytes) {
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK;
  }
  return h;
}

export function hashBytes(bytes) {
  return fnvWrite(FNV_OFFSET, bytes);
}

export function hex16(v) {
  return v.toString(16).padStart(16, "0");
}

// A u64 BigInt as 8 little-endian bytes (the run_hash fold input).
export function le8(v) {
  const o = new Uint8Array(8);
  for (let i = 0; i < 8; i++) o[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return o;
}
