import { test } from "vitest";
import assert from "node:assert/strict";
import {
  shouldHaltPlaylistQueue,
  type PlaylistQueueState,
} from "./playlist-queue-policy.ts";

test("should pause after two consecutive media access failures", () => {
  const state: PlaylistQueueState = {
    consecutiveAuthFailures: 0,
    haltedKind: null,
  };

  assert.equal(shouldHaltPlaylistQueue("unauthorized", state), false);
  assert.equal(state.consecutiveAuthFailures, 1);
  assert.equal(state.haltedKind, null);
  assert.equal(shouldHaltPlaylistQueue("unauthorized", state), true);
  assert.equal(state.consecutiveAuthFailures, 2);
  assert.equal(state.haltedKind, "unauthorized");
});

test("should continue after an item failure and reset access failures", () => {
  const state: PlaylistQueueState = {
    consecutiveAuthFailures: 1,
    haltedKind: null,
  };

  assert.equal(shouldHaltPlaylistQueue("item", state), false);
  assert.equal(state.consecutiveAuthFailures, 0);
  assert.equal(state.haltedKind, null);
  assert.equal(shouldHaltPlaylistQueue("unauthorized", state), false);
});

test("should pause immediately when the host limits requests or the engine fails", () => {
  for (const kind of ["rate-limited", "engine"] as const) {
    const state: PlaylistQueueState = {
      consecutiveAuthFailures: 1,
      haltedKind: null,
    };

    assert.equal(shouldHaltPlaylistQueue(kind, state), true);
    assert.equal(state.consecutiveAuthFailures, 0);
    assert.equal(state.haltedKind, kind);
  }
});
