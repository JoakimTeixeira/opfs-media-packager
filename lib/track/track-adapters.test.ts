import { test } from "vitest";
import assert from "node:assert/strict";
import {
  trackAdapterId,
  isApiTrackPage,
  isTrackPage,
} from "./track-adapters.ts";

test("should select the API course adapter from a secure course route", () => {
  const page = "https://training.example/courses/program/lessons/1";

  assert.equal(trackAdapterId(page), "api-track");
  assert.equal(isApiTrackPage(page), true);
  assert.equal(isTrackPage(page), true);
});

test("should select the sidebar course adapter from a lesson route", () => {
  const page = "https://training.example/c/program/sections/one/lessons/two";

  assert.equal(trackAdapterId(page), "sidebar-track");
  assert.equal(isApiTrackPage(page), false);
  assert.equal(isTrackPage(page), true);
});

test("should reject insecure or unrelated routes from course adapters", () => {
  for (const page of [
    "http://training.example/courses/program",
    "https://training.example/c/program",
    "https://training.example/c/program/sections/one",
    "https://training.example/prefix/c/program/sections/one/lessons/two",
    "https://training.example/c/program/sections/one/lessons/two/extra",
    "https://[invalid",
    "not a URL",
    new URL("https://training.example/courses/program"),
    null,
  ]) {
    assert.equal(trackAdapterId(page), null);
    assert.equal(isTrackPage(page), false);
  }
});
