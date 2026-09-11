// fault-palette (v1 conformance cart) — a DELIBERATELY faulting cart.
//
// It calls set_palette during update(), which the ABI permits only in
// start() (§4 Palette). Every runtime must trap and record the fault as
// verified state (§6a) — same frame, same kind across runtimes. There is no
// run_hash here; the manifest's [fault] pins the expected { frame, kind }.

import { clear, set_palette_bytes, WHITE } from "../../../sdk/assembly/index";

let pal = new StaticArray<u8>(3);

export function start(): void {
  pal[0] = 255;
  pal[1] = 0;
  pal[2] = 0;
}

export function update(): void {
  clear(WHITE);
  set_palette_bytes(pal, 1); // illegal outside start() → trap at frame 0
}
