// sys-load-error (v1.1 conformance cart) — a DELIBERATE privilege
// violation: a normal cart (no `system = true` in its manifest) that
// imports calyx.sys. Every runtime must refuse to instantiate it — the
// module simply isn't linked for normal carts (ABI §4b, link-time
// privilege; no capability flags, no runtime checks). This cart pins
// that refusal cross-runtime the way the fault carts pin trap/abort.

import {
  run_start, run_update, frame, clear, WHITE,
} from "../../../sdk/assembly/index";
import { launch } from "../../../sdk/assembly/sys";

function cart_ready(): void {}

function cart_process(): void {
  // referenced so the calyx.sys import is emitted; never reached —
  // instantiation fails first.
  if (frame() == 0x7fffffff) launch(0);
}

function cart_draw(): void {
  clear(WHITE);
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
