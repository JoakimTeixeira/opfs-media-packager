import { test } from "vitest";
import assert from "node:assert/strict";
import {
  embedPlayerAuthorizationRule,
  isEmbeddedVideoPlayerUrl,
  normalizeEmbedPlayerUrl,
  parseEmbedPlayerConfig,
} from "./embed-player.ts";

const EXTENSION_ID = "abcdefghijklmnopqrstuvwxyzabcdef";

test("should normalize supported embedded video player URLs and reject non-embed URLs", () => {
  assert.equal(
    normalizeEmbedPlayerUrl(
      "https://player.vimeo.com/video/900001001?app_id=990001",
    ),
    "https://player.vimeo.com/video/900001001?app_id=990001",
  );

  assert.equal(
    normalizeEmbedPlayerUrl("https://vimeo.com/900001001/abcdef1234"),
    "https://player.vimeo.com/video/900001001?h=abcdef1234",
  );

  assert.equal(
    normalizeEmbedPlayerUrl("https://vimeo.com/900001001?h=deadbeef"),
    "https://player.vimeo.com/video/900001001?h=deadbeef",
  );

  assert.equal(
    isEmbeddedVideoPlayerUrl("https://player.vimeo.com/video/42"),
    true,
  );

  assert.equal(
    isEmbeddedVideoPlayerUrl("https://www.youtube.com/watch?v=123456"),
    false,
  );

  assert.equal(
    normalizeEmbedPlayerUrl("http://player.vimeo.com/video/42"),
    null,
  );

  assert.equal(
    normalizeEmbedPlayerUrl("https://player.vimeo.com/channels/staff"),
    null,
  );

  assert.equal(normalizeEmbedPlayerUrl("not a url"), null);
  assert.equal(normalizeEmbedPlayerUrl(null), null);
});

test("should build a scoped authorization rule for an embedded video player", () => {
  const rule = embedPlayerAuthorizationRule(
    "https://player.vimeo.com/video/900001001?app_id=990001",
    "https://training.example/c/topic/sections/10/lessons/20",
    EXTENSION_ID,
    910055,
  );

  assert.deepEqual(rule, {
    id: 910055,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "referer",
          operation: "set",
          value: "https://training.example/c/topic/sections/10/lessons/20",
        },
        {
          header: "origin",
          operation: "set",
          value: "https://training.example",
        },
      ],
    },
    condition: {
      urlFilter: "||player.vimeo.com/video/900001001*",
      resourceTypes: ["xmlhttprequest", "other"],
    },
  });

  assert.equal(
    embedPlayerAuthorizationRule(
      "https://www.youtube.com/embed/abc",
      "https://training.example/c/topic/sections/10/lessons/20",
      EXTENSION_ID,
    ),
    null,
  );

  assert.equal(
    embedPlayerAuthorizationRule(
      "https://player.vimeo.com/video/42",
      "http://training.example/page",
      EXTENSION_ID,
    ),
    null,
  );

  assert.equal(
    embedPlayerAuthorizationRule(
      "https://player.vimeo.com/video/42",
      "https://training.example/page",
      "bad-id",
    ),
    null,
  );

  assert.equal(
    embedPlayerAuthorizationRule(
      "https://player.vimeo.com/video/42",
      "https://training.example/page",
      EXTENSION_ID,
      0,
    ),
    null,
  );
});

test("should extract HLS manifest, progressive MP4s, and subtitles from playerConfig HTML", () => {
  const html = `<!doctype html><html><script>
    window.playerConfig = {
      "video": { "title": "Lesson \\"One\\" {Demo}" },
      "request": {
        "files": {
          "hls": {
            "default_cdn": "akfire",
            "cdns": {
              "fastly": { "url": "https://cdn-b.example/hls/master.m3u8" },
              "akfire": { "url": "https://cdn-a.example/hls/playlist.m3u8?token=1" }
            }
          },
          "progressive": [
            { "height": 720, "width": 1280, "url": "https://cdn-a.example/720.mp4" },
            { "height": 1080, "width": 1920, "url": "https://cdn-a.example/1080.mp4" },
            { "height": 1080, "width": 1920, "url": "https://cdn-a.example/1080-dup.mp4" },
            { "height": 360, "url": "https://cdn-a.example/360.mp4" },
            { "quality": "240p", "url": "https://cdn-a.example/240.mp4" },
            { "url": "javascript:alert(1)", "quality": "bad" },
            null
          ]
        },
        "text_tracks": [
          { "url": "/texttrack/1001.vtt", "lang": "en-US", "label": "English" },
          { "url": "/texttrack/1001.vtt", "lang": "en-US", "label": "Duplicate" },
          { "url": "https://cdn-a.example/es.vtt", "language": "es" },
          { "url": "https://cdn-a.example/raw.vtt" },
          { "url": "" },
          null
        ]
      }
    };
  </script></html>`;

  const parsed = parseEmbedPlayerConfig(
    html,
    "https://player.vimeo.com/video/900001001?app_id=990001",
  );

  assert.ok(parsed);
  assert.equal(parsed.title, 'Lesson "One" {Demo}');

  assert.equal(
    parsed.hlsUrl,
    "https://cdn-a.example/hls/playlist.m3u8?token=1",
  );

  assert.deepEqual(parsed.progressiveOptions, [
    { url: "https://cdn-a.example/1080.mp4", label: "1080p (1920×1080)" },
    { url: "https://cdn-a.example/720.mp4", label: "720p (1280×720)" },
    { url: "https://cdn-a.example/360.mp4", label: "360p" },
    { url: "https://cdn-a.example/240.mp4", label: "240p" },
  ]);

  assert.deepEqual(parsed.subtitles, [
    {
      url: "https://player.vimeo.com/texttrack/1001.vtt",
      label: "English",
      language: "en-US",
    },
    {
      url: "https://cdn-a.example/es.vtt",
      label: "es",
      language: "es",
    },
    {
      url: "https://cdn-a.example/raw.vtt",
      label: "Subtitle",
      language: "",
    },
  ]);
});

test("should parse raw JSON configs, fallback CDNs, and handle malformed inputs cleanly", () => {
  const jsonConfig = JSON.stringify({
    request: {
      files: {
        hls: {
          cdns: {
            backup: { avc_url: "https://cdn.example/avc/master.m3u8" },
          },
        },
      },
    },
  });

  const fromJson = parseEmbedPlayerConfig(
    jsonConfig,
    "https://player.vimeo.com/video/99",
  );

  assert.equal(fromJson?.hlsUrl, "https://cdn.example/avc/master.m3u8");
  assert.equal(fromJson?.title, "");

  const inlineJsonHtml =
    '<script>boot({"request":{"files":{"hls":{"cdns":{"c":{"url":"https://cdn.example/inline.m3u8"}}}}}})</script>';

  assert.equal(
    parseEmbedPlayerConfig(inlineJsonHtml, "https://player.vimeo.com/video/99")
      ?.hlsUrl,
    "https://cdn.example/inline.m3u8",
  );

  assert.equal(
    parseEmbedPlayerConfig("", "https://player.vimeo.com/video/1"),
    null,
  );

  assert.equal(
    parseEmbedPlayerConfig("{bad json", "https://player.vimeo.com/video/1"),
    null,
  );

  assert.equal(
    parseEmbedPlayerConfig(
      "window.playerConfig = {unterminated",
      "https://player.vimeo.com/video/1",
    ),
    null,
  );

  assert.equal(
    parseEmbedPlayerConfig(
      "window.playerConfig = {bad};",
      "https://player.vimeo.com/video/1",
    ),
    null,
  );

  assert.equal(
    parseEmbedPlayerConfig(
      JSON.stringify({
        request: { files: { hls: { cdns: { a: { url: "ftp://bad" } } } } },
      }),
      "https://player.vimeo.com/video/1",
    ),
    null,
  );

  assert.equal(
    parseEmbedPlayerConfig(
      JSON.stringify({
        request: { files: { hls: { cdns: { a: { url: "http://[::1" } } } } },
      }),
      "not-a-base-url",
    ),
    null,
  );

  assert.equal(
    parseEmbedPlayerConfig(
      "var config = [];",
      "https://player.vimeo.com/video/1",
    ),
    null,
  );
});
