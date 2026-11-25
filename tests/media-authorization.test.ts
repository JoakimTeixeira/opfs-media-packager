import test from "node:test";
import assert from "node:assert/strict";
import { playlistMediaAuthorizationRule } from "../lib/media-authorization.ts";

const extensionId = "abcdefghijklmnopqrstuvwxzyabcdef";
const lessonUrl = "https://training.example/courses/course/lessons/1?chapter=1";

test("should authorize only the selected course media asset for extension fetches", () => {
  const rule = playlistMediaAuthorizationRule(
    "https://media.example.net/asset/720p/video.m3u8",
    lessonUrl,
    extensionId,
  );

  assert.equal(rule?.action.requestHeaders[0]?.value, lessonUrl);
  assert.equal(rule?.condition.urlFilter, "||media.example.net/asset/*");

  assert.deepEqual(rule, {
    id: 910001,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "referer",
          operation: "set",
          value: lessonUrl,
        },
        {
          header: "origin",
          operation: "set",
          value: "https://training.example",
        },
      ],
    },
    condition: {
      urlFilter: "||media.example.net/asset/*",
      resourceTypes: ["xmlhttprequest", "other"],
    },
  });
});

test("should freeze the returned authorization rule", () => {
  const rule = playlistMediaAuthorizationRule(
    "https://media.example.net/asset/720p/video.m3u8",
    lessonUrl,
    extensionId,
  );

  assert.equal(Object.isFrozen(rule), true);
  assert.equal(Object.isFrozen(rule?.action.requestHeaders), true);
});

test("should authorize master and playlist files only inside their exact asset directory", () => {
  for (const filename of ["master.m3u8", "playlist.m3u8"]) {
    const rule = playlistMediaAuthorizationRule(
      `https://media.example.net/assets/course/${filename}`,
      lessonUrl,
      extensionId,
    );

    assert.equal(
      rule?.condition.urlFilter,
      "||media.example.net/assets/course/*",
    );
  }
});

test("should accept only canonical rendition directory heights", () => {
  for (const height of ["100p", "720p", "9999p"]) {
    assert.ok(
      playlistMediaAuthorizationRule(
        `https://media.example.net/asset/${height}/video.m3u8`,
        lessonUrl,
        extensionId,
      ),
    );
  }

  for (const height of ["99p", "10000p", "0720p", "720P", "none"]) {
    assert.equal(
      playlistMediaAuthorizationRule(
        `https://media.example.net/asset/${height}/video.m3u8`,
        lessonUrl,
        extensionId,
      ),
      null,
    );
  }
});

test("should authorize sidebar course routes with signed-token HLS paths", () => {
  const sidebarLessonUrl =
    "https://training.example/c/sample-course/sections/101/lessons/1001";

  const rule = playlistMediaAuthorizationRule(
    "https://cdn.example.net/token_abc/11111111-1111-4111-8111-111111111111/hls/playlist.m3u8",
    sidebarLessonUrl,
    extensionId,
  );

  assert.equal(rule?.action.requestHeaders[0]?.value, sidebarLessonUrl);

  assert.equal(
    rule?.action.requestHeaders[1]?.value,
    "https://training.example",
  );

  assert.equal(
    rule?.condition.urlFilter,
    "||cdn.example.net/token_abc/11111111-1111-4111-8111-111111111111/hls/*",
  );
});

test("should refuse malformed or non-HLS authorization rules", () => {
  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/720p/video.ts",
      lessonUrl,
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/unrecognized/video.m3u8",
      lessonUrl,
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/720p/video.m3u8/extra",
      lessonUrl,
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/",
      lessonUrl,
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/720p/video.m3u8",
      lessonUrl,
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/720p/video.m3u8",
      "https://attacker.example/lesson",
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/720p/video.m3u8",
      lessonUrl,
      `${extensionId}a`,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/video.ts",
      lessonUrl,
      extensionId,
    ),
    null,
  );

  assert.equal(
    playlistMediaAuthorizationRule(
      "https://media.example.net/asset/720p/video.m3u8",
      "not a URL",
      extensionId,
    ),
    null,
  );
});
