import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  selectTouchJourneys,
  validateTouchJourneys,
} from "../testing/touch-journeys.mjs";

const journeys = JSON.parse(
  readFileSync(new URL("./touch-journeys.json", import.meta.url), "utf8"),
);
const catalog = {
  carts: journeys.map(({ name, category }) => ({ name, category })),
};

test("representative touch journeys cover the pinned product contracts", () => {
  assert.deepEqual(
    journeys.map(({ name, category, play }) => [name, category, play]),
    [
      ["Horizon Burn", "Games", "start"],
      ["hello-sunny", "Demos", "a"],
      ["Sunny API Lab", "Demos", "a"],
      ["Settings", "Settings", "down"],
    ],
  );
  assert.equal(validateTouchJourneys(catalog, journeys), journeys);
  assert.equal(
    validateTouchJourneys(
      { carts: [...catalog.carts, { name: "New Release Cart", category: "Games" }] },
      journeys,
    ),
    journeys,
  );
});

test("release excludes only Settings while Side B requires every journey", () => {
  const releaseCatalog = {
    carts: catalog.carts.filter((cart) => cart.name !== "Settings"),
  };
  assert.deepEqual(
    selectTouchJourneys(releaseCatalog, journeys, "release").map((journey) => journey.name),
    ["Horizon Burn", "hello-sunny", "Sunny API Lab"],
  );
  assert.deepEqual(selectTouchJourneys(catalog, journeys, "sideb"), journeys);

  const incompleteSideB = {
    carts: catalog.carts.filter((cart) => cart.name !== "Horizon Burn"),
  };
  assert.throws(
    () => selectTouchJourneys(incompleteSideB, journeys, "sideb"),
    /Horizon Burn: representative touch journey target is missing from catalog/,
  );
});

test("representative touch journeys reject missing and recategorized targets", () => {
  assert.throws(
    () => validateTouchJourneys({ carts: catalog.carts.slice(1) }, journeys),
    /Horizon Burn: representative touch journey target is missing from catalog/,
  );
  assert.throws(
    () => validateTouchJourneys(
      { carts: catalog.carts.map((cart) => cart.name === "Settings"
        ? { ...cart, category: "Demos" }
        : cart) },
      journeys,
    ),
    /Settings: representative touch journey expected category Settings, got Demos/,
  );
});
