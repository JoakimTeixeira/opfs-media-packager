import { expect, test } from "vitest";
import { parsePlaylist } from "./hls-parser.ts";

test("should resolve and order master playlist quality options", () => {
  const result = parsePlaylist(
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720\n720/index.m3u8\n",
    "https://media.example/master.m3u8",
  );

  expect(result.type).toBe("master");
  if (result.type !== "master") throw new Error("Expected a master playlist");

  expect(result.qualityOptions[0]).toMatchObject({
    uri: "https://media.example/720/index.m3u8",
    label: "720p (1280×720)",
  });
});

test("should attach separate audio rendition URIs from EXT-X-MEDIA groups", () => {
  const result = parsePlaylist(
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",DEFAULT=YES,URI="audio/index.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080,AUDIO="audio-high"',
      "video/1080/index.m3u8",
    ].join("\n"),
    "https://media.example/sep/master.m3u8",
  );

  expect(result.type).toBe("master");
  if (result.type !== "master") throw new Error("Expected a master playlist");

  expect(result.qualityOptions[0]).toMatchObject({
    uri: "https://media.example/sep/video/1080/index.m3u8",
    audioUri: "https://media.example/sep/audio/index.m3u8",
    label: "1080p (1920×1080)",
  });
});

test("should parse media ranges, discontinuities, and completed playlists", () => {
  const result = parsePlaylist(
    "#EXTM3U\n#EXT-X-BYTERANGE:10@0\n#EXTINF:2,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:3,\nb.ts\n#EXT-X-ENDLIST\n",
    "https://media.example/video.m3u8",
  );

  expect(result.type).toBe("media");
  if (result.type !== "media") throw new Error("Expected a media playlist");
  expect(result.segments[0].range?.header).toBe("bytes=0-9");
  expect(result.segments[1].discontinuity).toBe(true);
  expect(result.totalDurationSeconds).toBe(5);
  expect(result.complete).toBe(true);
});

test("should reject protected and invalid manifests", () => {
  expect(() =>
    parsePlaylist("not an HLS manifest", "https://media.example/a"),
  ).toThrow("HLS manifest");

  expect(() =>
    parsePlaylist(
      "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\na.ts",
      "https://media.example/a",
    ),
  ).toThrow("Encrypted manifest");
});
