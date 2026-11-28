import { test } from "vitest";
import assert from "node:assert/strict";
import {
  shouldHaltTrackQueue,
  type TrackQueueState,
} from "./track-queue-policy.ts";

test("should pause after two consecutive media access failures", () => {
  const state: TrackQueueState = {
    consecutiveAuthFailures: 0,
    haltedKind: null,
  };

  assert.equal(shouldHaltTrackQueue("unauthorized", state), false);
  assert.equal(state.consecutiveAuthFailures, 1);
  assert.equal(state.haltedKind, null);
  assert.equal(shouldHaltTrackQueue("unauthorized", state), true);
  assert.equal(state.consecutiveAuthFailures, 2);
  assert.equal(state.haltedKind, "unauthorized");
});

test("should continue after an item failure and reset access failures", () => {
  const state: TrackQueueState = {
    consecutiveAuthFailures: 1,
    haltedKind: null,
  };

  assert.equal(shouldHaltTrackQueue("item", state), false);
  assert.equal(state.consecutiveAuthFailures, 0);
  assert.equal(state.haltedKind, null);
  assert.equal(shouldHaltTrackQueue("unauthorized", state), false);
});

test("should pause immediately when the host limits requests or the engine fails", () => {
  for (const kind of ["rate-limited", "engine"] as const) {
    const state: TrackQueueState = {
      consecutiveAuthFailures: 1,
      haltedKind: null,
    };

    assert.equal(shouldHaltTrackQueue(kind, state), true);
    assert.equal(state.consecutiveAuthFailures, 0);
    assert.equal(state.haltedKind, kind);
  }
});
