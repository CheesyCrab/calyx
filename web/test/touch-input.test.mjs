import test from "node:test";
import assert from "node:assert/strict";

import { TOUCH_BITS, TouchState, dpadMaskAt } from "../src/touch-input.mjs";

const bit = (name) => 1 << TOUCH_BITS[name];
const rect = { left: 0, top: 0, width: 100, height: 100 };

test("extended touch controls append stable ABI bits", () => {
  assert.deepEqual(
    { x: TOUCH_BITS.x, y: TOUCH_BITS.y, l: TOUCH_BITS.l, r: TOUCH_BITS.r },
    { x: 7, y: 8, l: 9, r: 10 },
  );
});

test("D-pad center is neutral and eight sectors include diagonals", () => {
  assert.equal(dpadMaskAt(rect, 50, 50), 0);
  assert.equal(dpadMaskAt(rect, 50, 2), bit("up"));
  assert.equal(dpadMaskAt(rect, 98, 50), bit("right"));
  assert.equal(dpadMaskAt(rect, 50, 98), bit("down"));
  assert.equal(dpadMaskAt(rect, 2, 50), bit("left"));
  assert.equal(dpadMaskAt(rect, 90, 10), bit("up") | bit("right"));
  assert.equal(dpadMaskAt(rect, 90, 90), bit("down") | bit("right"));
  assert.equal(dpadMaskAt(rect, 10, 90), bit("down") | bit("left"));
  assert.equal(dpadMaskAt(rect, 10, 10), bit("up") | bit("left"));
});

test("touch pointers hold, chord, transfer, share, and release idempotently", () => {
  const changes = [];
  const state = new TouchState((mask) => changes.push(mask));
  state.set(1, "dpad", bit("up") | bit("right"));
  state.set(2, "a", bit("a"));
  assert.equal(state.heldMask(), bit("up") | bit("right") | bit("a"));

  state.set(1, "dpad", bit("left"));
  assert.equal(state.heldMask(), bit("left") | bit("a"));
  state.set(3, "a", bit("a"));
  state.release(2);
  assert.equal(state.heldMask(), bit("left") | bit("a"));
  assert.equal(state.release(99), false);
  state.set(1, null, 0);
  state.release(3);
  assert.equal(state.heldMask(), 0);
  assert.ok(changes.length >= 6);
});

test("global clear releases every pointer once", () => {
  let latest = -1;
  const state = new TouchState((mask) => { latest = mask; });
  state.set(1, "start", bit("start"));
  state.set(2, "b", bit("b"));
  assert.equal(state.clear(), true);
  assert.equal(latest, 0);
  assert.equal(state.pointers.size, 0);
  assert.equal(state.clear(), false);
});

test("extended touch pointers preserve X Y L and R as independent bits", () => {
  const state = new TouchState();
  for (const [pointer, name] of [[1, "x"], [2, "y"], [3, "l"], [4, "r"]]) {
    state.set(pointer, name, bit(name));
  }
  assert.equal(state.heldMask(), bit("x") | bit("y") | bit("l") | bit("r"));
  state.clear();
  assert.equal(state.heldMask(), 0);
});
