// fault-abort (v1 conformance cart) — a DELIBERATELY faulting cart.
//
// It triggers an AssemblyScript abort (assert(false)) on a chosen frame.
// The host surfaces env.abort as a fault with kind "abort" (§6a) — closing
// the proto's silent-abort hole. The frames before it run normally, so the
// fault's frame index is itself verified state.

import { clear, frame, WHITE } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  clear(WHITE);
  if (frame() == 3) assert(false, "deliberate abort at frame 3");
}
