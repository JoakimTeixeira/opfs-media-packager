import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeDetectedStreams,
  type MergeableStream,
} from "../lib/stream-collection.ts";

test("should merge signed observations of the same player", () => {
  const asset = "22222222-2222-4222-8222-222222222222";

  const streams = mergeDetectedStreams([
    {
      url: `https://signed-media.example/token=old/${asset}/hls/playlist.m3u8`,
      qualityOptions: [
        {
          url: `https://signed-media.example/token=old/${asset}/hls/1080p/video.m3u8`,
          label: "1080p (1920×1080)",
        },
        {
          url: `https://signed-media.example/token=old/${asset}/hls/720p/video.m3u8`,
          label: "720p (1280×720)",
        },
        {
          url: `https://signed-media.example/token=old/${asset}/hls/480p/video.m3u8`,
          label: "480p (854×480)",
        },
      ],
      subtitles: [{ url: "https://cdn.example/pt.vtt" }],
    },
    {
      url: `https://signed-media.example/token=new/${asset}/hls/720p/playlist.m3u8`,
      kind: "master",
      qualityOptions: [
        {
          url: `https://signed-media.example/token=new/${asset}/hls/1080p/video.m3u8`,
          label: "1080p (1920×1080)",
        },
        {
          url: `https://signed-media.example/token=new/${asset}/hls/720p/video.m3u8`,
          label: "720p (1280×720)",
        },
        {
          url: `https://signed-media.example/token=new/${asset}/hls/480p/video.m3u8`,
          label: "480p (854×480)",
        },
      ],
      subtitles: [{ url: "https://cdn.example/pt.vtt" }],
    },
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0]?.kind, "master");

  assert.deepEqual(
    streams[0]?.qualityOptions?.map((option) => option.label),
    ["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"],
  );

  assert.equal(streams[0]?.subtitles?.length, 1);
});

test("should retain distinct stream assets", () => {
  const streams = mergeDetectedStreams([
    { url: "https://cdn.example/one/playlist.m3u8" },
    { url: "https://cdn.example/two/playlist.m3u8" },
  ]);

  assert.equal(streams.length, 2);
});

test("should ignore incomplete observations and retain the richer non-master record", () => {
  const streams = mergeDetectedStreams([
    null,
    "not a stream",
    { key: "key-only" },
    { url: "https://cdn.example/asset/playlist.m3u8" },
    {
      url: "https://cdn.example/asset/720p/video.m3u8",
      kind: "media",
      qualityOptions: [
        { url: "https://cdn.example/720.m3u8", label: "720p" },
        { url: "https://cdn.example/720.m3u8", label: "720p" },
        {},
      ],
      subtitles: [{ url: "https://cdn.example/en.vtt" }, {}, null],
    },
  ] as unknown as readonly MergeableStream[]);

  assert.equal(streams.length, 2);
  assert.equal(streams[1]?.kind, "media");
  assert.equal(streams[1]?.qualityOptions?.length, 1);
  assert.equal(streams[1]?.subtitles?.length, 1);
});

test("should retain a master record while merging a later direct rendition", () => {
  const streams = mergeDetectedStreams([
    {
      url: "https://cdn.example/asset/master.m3u8",
      kind: "master",
      qualityOptions: [{ url: "https://cdn.example/720.m3u8", label: "720p" }],
    },
    {
      url: "https://cdn.example/asset/480p/video.m3u8",
      kind: "media",
      qualityOptions: [{ url: "https://cdn.example/480.m3u8", label: "480p" }],
    },
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0]?.kind, "master");
  assert.equal(streams[0]?.qualityOptions?.length, 2);
});

test("should keep a complete key fallback and a larger existing non-master observation", () => {
  const streams = mergeDetectedStreams([
    {},
    { key: "key-only" },
    {
      url: "https://cdn.example/asset/playlist.m3u8",
      kind: "media",
      qualityOptions: [
        { url: "https://cdn.example/360.m3u8" },
        { url: "https://cdn.example/480.m3u8", label: "480p" },
      ],
    },
    {
      url: "https://cdn.example/asset/720p/video.m3u8",
      kind: "media",
      qualityOptions: [{ url: "https://cdn.example/720.m3u8", label: "720p" }],
    },
  ]);

  assert.equal(streams.length, 2);
  assert.equal(streams[1]?.qualityOptions?.length, 3);
});
