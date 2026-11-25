import test from "node:test";
import assert from "node:assert/strict";
import {
  playlistAdapterId,
  isApiPlaylistPage,
  isPlaylistPage,
} from "../lib/playlist-adapters.ts";

test("should select the API course adapter from a secure course route", () => {
  const page = "https://training.example/courses/program/lessons/1";

  assert.equal(playlistAdapterId(page), "api-playlist");
  assert.equal(isApiPlaylistPage(page), true);
  assert.equal(isPlaylistPage(page), true);
});

test("should select the sidebar course adapter from a lesson route", () => {
  const page = "https://training.example/c/program/sections/one/lessons/two";

  assert.equal(playlistAdapterId(page), "sidebar-playlist");
  assert.equal(isApiPlaylistPage(page), false);
  assert.equal(isPlaylistPage(page), true);
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
    assert.equal(playlistAdapterId(page), null);
    assert.equal(isPlaylistPage(page), false);
  }
});
