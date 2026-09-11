// palettes — Calyx's named palettes as Sunny data (ABI §4a), lowered
// through set_palette. Values are copied verbatim from
// godot/shared/console_config.gd so `use_palette("GAMEBOY")` means the
// same thing it meant in a Godot cart.
//
// start()-only, like the import it lowers to (ABI §4 Palette). The
// default SWEETIE_16 is a no-op — carts that never declare a palette
// keep the clean "SWEETIE_16" verified state in status.json. An unknown
// name aborts (fail fast, never a silent fallback — the feed-format
// precedent, ABI §6a).

import { set_palette_bytes } from "./draw";

const MONO_RGB: StaticArray<u8> = [
  0x00, 0x00, 0x00,
  0xff, 0xff, 0xff,
];

const GAMEBOY_RGB: StaticArray<u8> = [
  0x0f, 0x38, 0x0f,
  0x30, 0x62, 0x30,
  0x8b, 0xac, 0x0f,
  0x9b, 0xbc, 0x0f,
];

const GBA_WARM_RGB: StaticArray<u8> = [
  0x1a, 0x0a, 0x00, // 0  near-black
  0xff, 0xfb, 0xe8, // 1  cream white
  0x2b, 0x1a, 0x0f, // 2  espresso
  0x6b, 0x3a, 0x2a, // 3  sienna
  0xc0, 0x39, 0x2b, // 4  red
  0xe6, 0x7e, 0x22, // 5  orange
  0xf1, 0xc4, 0x0f, // 6  gold
  0xa8, 0xd8, 0xa8, // 7  sage green
  0x27, 0xae, 0x60, // 8  green
  0x1e, 0x84, 0x49, // 9  forest
  0x1a, 0x4a, 0x6b, // 10 deep navy
  0x29, 0x80, 0xb9, // 11 sky blue
  0x7f, 0xb3, 0xd3, // 12 pale blue
  0xae, 0xd6, 0xf1, // 13 ice blue
  0xd5, 0xc5, 0xa1, // 14 warm tan
  0x8c, 0x7b, 0x6b, // 15 warm gray
  0x4a, 0x37, 0x28, // 16 bark
  0x7b, 0x5e, 0x3a, // 17 caramel
  0xc8, 0xa9, 0x6e, // 18 wheat
  0xf2, 0xd7, 0xb6, // 19 peach
  0xe8, 0xb4, 0xb8, // 20 dusty rose
  0xc0, 0x70, 0x8a, // 21 mauve
  0x7d, 0x3c, 0x59, // 22 plum
  0x3d, 0x1a, 0x47, // 23 deep violet
  0x6a, 0x4c, 0x93, // 24 purple
  0xb0, 0x9f, 0xce, // 25 lavender
  0x56, 0xc4, 0xc4, // 26 jade
  0x2e, 0x8b, 0x8b, // 27 deep teal
  0xc8, 0xde, 0xa8, // 28 pale mint
  0xe8, 0xc8, 0x6e, // 29 butter
  0xb0, 0x50, 0x20, // 30 terra cotta
  0x6b, 0x20, 0x20, // 31 dark crimson
];

export function use_palette(name: string): void {
  if (name == "SWEETIE_16") return; // the default — nothing to declare
  if (name == "MONO") {
    set_palette_bytes(MONO_RGB, 2);
    return;
  }
  if (name == "GAMEBOY") {
    set_palette_bytes(GAMEBOY_RGB, 4);
    return;
  }
  if (name == "GBA_WARM") {
    set_palette_bytes(GBA_WARM_RGB, 32);
    return;
  }
  assert(false, "unknown palette: " + name);
}
