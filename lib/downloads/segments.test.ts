import { test } from "vitest";
import assert from "node:assert/strict";
import {
  clampConcurrency,
  DEFAULT_SEGMENT_CONCURRENCY,
  MAX_SEGMENT_CONCURRENCY,
  MIN_SEGMENT_CONCURRENCY,
  orderedSegmentGroups,
} from "./segments.ts";

test("should limit configured concurrency to 1 through 10", () => {
  assert.equal(MIN_SEGMENT_CONCURRENCY, 1);
  assert.equal(MAX_SEGMENT_CONCURRENCY, 10);
  assert.equal(DEFAULT_SEGMENT_CONCURRENCY, 3);
  assert.equal(clampConcurrency(0), 1);
  assert.equal(clampConcurrency(3.8), 3);
  assert.equal(clampConcurrency(10), 10);
  assert.equal(clampConcurrency(99), 10);
  assert.equal(clampConcurrency(Number.NaN), 3);
});

test("should keep segment order while batching concurrent fetches", () => {
  assert.deepEqual(orderedSegmentGroups([1, 2, 3, 4, 5, 6, 7], 3), [
    [1, 2, 3],
    [4, 5, 6],
    [7],
  ]);
});

test("should not add an empty batch at exact boundaries", () => {
  assert.deepEqual(orderedSegmentGroups([1, 2, 3, 4], 2), [
    [1, 2],
    [3, 4],
  ]);

  assert.deepEqual(orderedSegmentGroups([], 2), []);

  assert.deepEqual(orderedSegmentGroups([1, 2], Number.POSITIVE_INFINITY), [
    [1, 2],
  ]);
});
