import test from "node:test";
import assert from "node:assert/strict";
import {
  numericQualityOptions,
  mediaReferrerPolicy,
  masterUrlForDetectedPlaylist,
} from "../../lib/player-adapters.ts";

test("should map a numeric quality playlist to its master manifest", () => {
  const quality = "https://media.example.net/video-id/1080p/video.m3u8";

  assert.equal(
    masterUrlForDetectedPlaylist(quality),
    "https://media.example.net/video-id/playlist.m3u8",
  );

  assert.equal(
    masterUrlForDetectedPlaylist(
      "https://media.example.net/video-id/master.m3u8",
    ),
    "https://media.example.net/video-id/playlist.m3u8",
  );

  assert.equal(
    masterUrlForDetectedPlaylist("https://cdn.example/stream.m3u8"),
    null,
  );

  assert.equal(masterUrlForDetectedPlaylist("not a URL"), null);
});

test("should preserve quality query strings while rejecting malformed paths", () => {
  const url =
    "https://media.example.net/course/1080p/video.m3u8?token=abc#part";

  assert.equal(
    masterUrlForDetectedPlaylist(url),
    "https://media.example.net/course/playlist.m3u8?token=abc#part",
  );

  assert.equal(
    masterUrlForDetectedPlaylist(
      "https://media.example.net/course/1080p/video.m3u8x",
    ),
    null,
  );

  assert.equal(
    masterUrlForDetectedPlaylist("https://media.example.net/course/1080p/"),
    null,
  );
});

test("should list numeric quality options from master and playlist URLs", () => {
  const options = numericQualityOptions(
    "https://media.example.net/course-id/master.m3u8?token=abc",
  );

  assert.deepEqual(
    options.map((option) => option.label),
    ["1080p", "720p", "480p", "360p", "240p"],
  );

  assert.equal(
    options[1]?.url,
    "https://media.example.net/course-id/720p/video.m3u8?token=abc",
  );

  assert.deepEqual(
    numericQualityOptions(
      "https://media.example.net/course-id/playlist.m3u8?token=abc",
    ).map((option) => option.label),
    ["1080p", "720p", "480p", "360p", "240p"],
  );

  assert.deepEqual(numericQualityOptions("https://cdn.example/video.ts"), []);

  assert.deepEqual(
    numericQualityOptions(
      "https://media.example.net/course/not-a-playlist.m3u8",
    ),
    [],
  );

  assert.deepEqual(numericQualityOptions("not a URL"), []);
});

test("should use the complete lesson referer for a structured course stream", () => {
  const lesson = "https://training.example/courses/course/lessons/1?chapter=1";

  assert.equal(
    mediaReferrerPolicy(
      "https://media.example.net/video/720p/video.m3u8",
      lesson,
    ),
    "unsafe-url",
  );

  assert.equal(
    mediaReferrerPolicy("https://cdn.example/video.m3u8", lesson),
    "strict-origin-when-cross-origin",
  );

  assert.equal(
    mediaReferrerPolicy("not a URL", lesson),
    "strict-origin-when-cross-origin",
  );

  assert.equal(
    mediaReferrerPolicy(
      "https://media.example.net/video/720p/video.m3u8",
      "not a URL",
    ),
    "strict-origin-when-cross-origin",
  );
});
