import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIRM_CHOICE,
  DESTRUCTIVE_ACTION,
  DestructiveConfirmation,
} from "../src/destructive-confirmation.mjs";

test("destructive confirmation is cancel-first", () => {
  const prompt = new DestructiveConfirmation();
  prompt.open(DESTRUCTIVE_ACTION.HOME);
  assert.equal(prompt.action, DESTRUCTIVE_ACTION.HOME);
  assert.equal(prompt.choice, CONFIRM_CHOICE.CANCEL);
  assert.equal(prompt.acceptedAction(), null);
});

test("only an explicitly selected confirmation accepts the pending action", () => {
  const prompt = new DestructiveConfirmation();
  prompt.open(DESTRUCTIVE_ACTION.QUIT);
  prompt.toggle();
  assert.equal(prompt.acceptedAction(), DESTRUCTIVE_ACTION.QUIT);
  prompt.close();
  assert.equal(prompt.action, null);
  assert.equal(prompt.choice, CONFIRM_CHOICE.CANCEL);
});

test("unknown destructive actions are rejected", () => {
  assert.throws(() => new DestructiveConfirmation().open("restart"), /bad destructive action/);
});
