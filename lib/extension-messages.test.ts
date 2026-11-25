import test from "node:test";
import assert from "node:assert/strict";
import {
  isTrustedExtensionSender,
  isTrustedPlaylistSender,
  isTrustedPlaylistFrameSender,
  isTrustedApiPlaylistSender,
  validatedDownloadRequest,
} from "./extension-messages.ts";

test("should allow privileged actions only from this extension's own pages", () => {
  const forgedFunctionSender = Object.assign(() => {}, {
    id: "extension",
    frameId: 0,
    url: "chrome-extension://extension/popup.html",
  });

  assert.equal(
    isTrustedExtensionSender(
      undefined,
      "extension",
      "chrome-extension://extension/",
    ),
    false,
  );

  assert.equal(
    isTrustedExtensionSender(
      forgedFunctionSender,
      "extension",
      "chrome-extension://extension/",
    ),
    false,
  );

  assert.equal(
    isTrustedExtensionSender(
      { id: "extension", url: "chrome-extension://extension/popup.html" },
      "extension",
      "chrome-extension://extension/",
    ),
    true,
  );

  assert.equal(
    isTrustedExtensionSender(
      { id: "extension", url: "https://attacker.example" },
      "extension",
      "chrome-extension://extension/",
    ),
    false,
  );

  assert.equal(
    isTrustedExtensionSender(
      { id: "extension", url: 3 },
      "extension",
      "chrome-extension://extension/",
    ),
    false,
  );

  assert.equal(
    isTrustedExtensionSender(
      { id: "other-extension", url: "chrome-extension://extension/popup.html" },
      "extension",
      "chrome-extension://extension/",
    ),
    false,
  );
});

test("should restrict API and top-level course senders to frameId 0 and trusted routes", () => {
  assert.equal(
    isTrustedApiPlaylistSender(
      {
        id: "extension",
        frameId: 0,
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    true,
  );

  assert.equal(
    isTrustedApiPlaylistSender(
      {
        id: "extension",
        frameId: 1,
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedApiPlaylistSender(
      { id: "other", frameId: 0, url: "https://training.example/courses/a" },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedApiPlaylistSender(
      { id: "extension", frameId: 0, url: "https://training.example/other" },
      "extension",
    ),
    false,
  );

  assert.equal(isTrustedApiPlaylistSender(null, "extension"), false);

  assert.equal(
    isTrustedPlaylistSender(
      {
        id: "extension",
        frameId: 0,
        url: "https://training.example/c/course/sections/one/lessons/two",
      },
      "extension",
    ),
    true,
  );

  assert.equal(
    isTrustedPlaylistSender(
      {
        id: "extension",
        frameId: 1,
        url: "https://training.example/c/course/sections/one/lessons/two",
      },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedPlaylistSender(
      {
        id: "extension",
        frameId: 0,
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    true,
  );

  assert.equal(
    isTrustedPlaylistSender(
      { id: "extension", frameId: 0, url: "https://training.example/c/course" },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedPlaylistSender(
      {
        id: "other-extension",
        frameId: 0,
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    false,
  );

  assert.equal(isTrustedPlaylistSender(undefined, "extension"), false);
});

test("should allow hidden same-origin probe frames only via isTrustedPlaylistFrameSender", () => {
  assert.equal(
    isTrustedPlaylistFrameSender(
      {
        id: "extension",
        frameId: 0,
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    true,
  );

  assert.equal(
    isTrustedPlaylistFrameSender(
      {
        id: "extension",
        frameId: 42,
        url: "https://training.example/courses/a/1/2/3/conteudos?conteudo=7",
      },
      "extension",
    ),
    true,
  );

  assert.equal(
    isTrustedPlaylistFrameSender(
      {
        id: "extension",
        frameId: 42,
        url: "https://training.example/c/course/sections/one/lessons/two",
      },
      "extension",
    ),
    true,
  );

  assert.equal(
    isTrustedPlaylistFrameSender(
      {
        id: "extension",
        frameId: -1,
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedPlaylistFrameSender(
      { id: "other", frameId: 42, url: "https://training.example/courses/a" },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedPlaylistFrameSender(
      { id: "extension", frameId: 42, url: "https://attacker.example/other" },
      "extension",
    ),
    false,
  );

  assert.equal(
    isTrustedPlaylistFrameSender(
      {
        id: "extension",
        frameId: "0",
        url: "https://training.example/courses/a",
      },
      "extension",
    ),
    false,
  );

  assert.equal(isTrustedPlaylistFrameSender(null, "extension"), false);
});

test("should validate the download request once at the privileged boundary", () => {
  assert.equal(validatedDownloadRequest(undefined), null);

  const request = validatedDownloadRequest({
    url: "https://cdn.example/master.m3u8",
    selectedQualityUrl: "https://cdn.example/1080/video.m3u8",
    title: "x".repeat(300),
    sourceUrl: "https://course.example/page",
    sourceTabId: 7,
    outputFormat: "mp4",
    autoStart: true,
    subtitle: { url: "https://cdn.example/caption.vtt", language: "English" },
    qualityOptions: [
      { url: "https://cdn.example/720p/video.m3u8", label: "720p" },
      { url: "https://cdn.example/invalid.m3u8", label: "Source playlist" },
    ],
  });

  assert.equal(request?.title.length, 240);
  assert.equal(request?.outputFormat, "mp4");
  assert.equal(request?.autoStart, true);
  assert.equal(request?.sourceTabId, 7);

  assert.deepEqual(request?.subtitle, {
    url: "https://cdn.example/caption.vtt",
    language: "English",
    label: "",
  });

  assert.deepEqual(request?.qualityOptions, [
    { url: "https://cdn.example/720p/video.m3u8", label: "720p" },
  ]);

  assert.equal(Object.isFrozen(request), true);

  assert.equal(
    validatedDownloadRequest({
      url: "https://cdn.example/master.m3u8",
      selectedQualityUrl: "http://127.0.0.1/video.m3u8",
    }),
    null,
  );

  assert.equal(
    validatedDownloadRequest({
      url: "https://cdn.example/master.m3u8",
      selectedQualityUrl: "https://cdn.example/video.m3u8",
      subtitle: { url: "file:///caption.vtt" },
    }),
    null,
  );

  assert.deepEqual(
    validatedDownloadRequest({
      url: "https://cdn.example/master.m3u8",
      selectedVariant: "https://cdn.example/video.m3u8",
      sourceTabId: 0,
    }),
    {
      url: "https://cdn.example/master.m3u8",
      selectedQualityUrl: "https://cdn.example/video.m3u8",
      title: "",
      sourceUrl: "",
      sourceTabId: 0,
      selectedLabel: "",
      qualityOptions: [],
      outputFormat: "mp4",
      autoStart: false,
      subtitle: null,
    },
  );

  // Boundary & sanitization checks for sourceTabId, qualityOptions cap/regex/trim, and invalid subtitle shapes.
  const elevenOptions = Array.from({ length: 11 }, (_, idx) => ({
    url: `https://cdn.example/${idx}.m3u8`,
    label: `  ${360 + idx * 10}p (${idx})  `,
  }));

  const capped = validatedDownloadRequest({
    url: "https://cdn.example/master.m3u8",
    selectedQualityUrl: "https://cdn.example/video.m3u8",
    sourceTabId: -1,
    qualityOptions: [
      null,
      "not-an-object",
      { url: "https://cdn.example/bad1.m3u8", label: "x720p" },
      { url: "https://cdn.example/bad2.m3u8", label: "720pHD" },
      { url: "https://cdn.example/trimmed.m3u8", label: " 1080p " },
      { url: "https://cdn.example/spaced.m3u8", label: "720p (1280×720)" },
      ...elevenOptions,
    ],
  });

  assert.equal(capped?.sourceTabId, null);

  assert.deepEqual(capped?.qualityOptions, [
    { url: "https://cdn.example/trimmed.m3u8", label: "1080p" },
    { url: "https://cdn.example/spaced.m3u8", label: "720p (1280×720)" },
    { url: "https://cdn.example/0.m3u8", label: "360p (0)" },
    { url: "https://cdn.example/1.m3u8", label: "370p (1)" },
    { url: "https://cdn.example/2.m3u8", label: "380p (2)" },
    { url: "https://cdn.example/3.m3u8", label: "390p (3)" },
  ]);

  const cappedPure = validatedDownloadRequest({
    url: "https://cdn.example/master.m3u8",
    selectedQualityUrl: "https://cdn.example/video.m3u8",
    sourceTabId: "7",
    qualityOptions: elevenOptions,
  });

  assert.equal(cappedPure?.sourceTabId, null);
  assert.equal(cappedPure?.qualityOptions.length, 10);

  assert.equal(
    validatedDownloadRequest({
      url: "https://cdn.example/master.m3u8",
      selectedQualityUrl: "https://cdn.example/video.m3u8",
      subtitle: "not-an-object",
    }),
    null,
  );
});
