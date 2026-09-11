import { test } from "node:test";
import assert from "node:assert/strict";

import { presentationRate, shouldPresent } from "../src/presentation.mjs";

test("presentation cadence defaults to 60 and validates catalog values", () => {
  assert.equal(presentationRate(undefined), 60);
  assert.equal(presentationRate(30), 30);
  assert.equal(presentationRate(60), 60);
  assert.throws(() => presentationRate(24), /30 or 60/);
  assert.throws(() => presentationRate("30"), /30 or 60/);
});

test("30 Hz presents completed ticks 1, 3, 5 to match even cart frames", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].filter((tick) => shouldPresent(tick, 30)),
    [1, 3, 5],
  );
  assert.deepEqual(
    [1, 2, 3].filter((tick) => shouldPresent(tick, 60)),
    [1, 2, 3],
  );
});
