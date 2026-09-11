import test from "node:test";
import assert from "node:assert/strict";

import { decodeTone, scheduledTime, TonePresenter } from "../src/audio.mjs";

test("tone flags decode four waveforms and channels", () => {
  for (let i = 0; i < 4; i++) {
    const tone = decodeTone({ freq: 220 + i, dur: 30, vol: 20 + i, flags: i | (i << 2) });
    assert.equal(tone.wave, i);
    assert.equal(tone.channel, i);
    assert.equal(tone.duration, 0.5);
  }
});

test("tone values clamp at the presenter boundary", () => {
  assert.deepEqual(
    decodeTone({ freq: -1, dur: -2, vol: 999, flags: 0 }),
    { frequency: 0, duration: 0, volume: 1, wave: 0, channel: 0 },
  );
});

test("scheduler preserves future frame spacing but never schedules in the past", () => {
  assert.equal(scheduledTime(10, 30, 60, 10), 10.5);
  assert.equal(scheduledTime(10, 30, 60, 12), 12);
});

test("audio is fail-open where AudioContext is unavailable", async () => {
  const presenter = new TonePresenter();
  assert.equal(await presenter.unlock(), false);
  assert.doesNotThrow(() => presenter.frame(0, [{ freq: 440, dur: 30, vol: 80, flags: 0 }]));
});
