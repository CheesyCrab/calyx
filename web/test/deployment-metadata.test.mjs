import test from "node:test";
import assert from "node:assert/strict";
import { matchingDeployment } from "../src/deployment-metadata.mjs";

test("accepts deployment metadata only for the loaded release", () => {
  const release = { payload_id: "current" };
  const current = { payload_id: "current", note: "current note" };
  const stale = { payload_id: "stale", note: "stale note" };

  assert.equal(matchingDeployment(release, current, stale), current);
  assert.equal(matchingDeployment(release, stale, current), current);
  assert.equal(matchingDeployment(release, stale, null), null);
});
