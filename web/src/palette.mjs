// Palette — SWEETIE_16 default, optional per-cart override (ABI §1.1, §4).
//
// The framebuffer hash is over index bytes, so a set_palette call is
// invisible to it; the palette is recorded as verified state in its own
// right — id() is "SWEETIE_16" or "custom:<digest>", the digest being
// FNV-1a-64 over the declared 3×count RGB bytes (ABI §6a).

import { hashBytes, hex16 } from "./fnv.mjs";

// The Calyx default palette (ABI §1.1), copied verbatim.
export const SWEETIE_16 = [
  [0x00, 0x00, 0x00], [0xff, 0xff, 0xff], [0x1a, 0x1c, 0x2c], [0x5d, 0x27, 0x5d],
  [0xb1, 0x3e, 0x53], [0xef, 0x7d, 0x57], [0xff, 0xcd, 0x75], [0xa7, 0xf0, 0x70],
  [0x38, 0xb7, 0x64], [0x25, 0x71, 0x79], [0x29, 0x36, 0x6f], [0x3b, 0x5d, 0xc9],
  [0x41, 0xa6, 0xf6], [0x73, 0xef, 0xf7], [0x94, 0xb0, 0xc2], [0x56, 0x6c, 0x86],
];

export class Palette {
  constructor() {
    this.entries = SWEETIE_16.map((e) => e.slice());
    this.customDigest = null; // BigInt once a cart declared its own palette
  }

  // Replace the palette from index 0 with `count` packed RGB888 triples
  // (`rgb` holds count*3 bytes). The caller enforces start()-only + count<=256.
  setFromRgb(rgb, count) {
    for (let i = 0; i < count; i++) {
      const e = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
      if (i < this.entries.length) this.entries[i] = e;
      else this.entries.push(e);
    }
    this.customDigest = hashBytes(rgb.subarray(0, count * 3));
  }

  rgb(idx) {
    return this.entries[idx] ?? [0, 0, 0];
  }

  id() {
    return this.customDigest === null
      ? "SWEETIE_16"
      : `custom:${hex16(this.customDigest)}`;
  }
}
