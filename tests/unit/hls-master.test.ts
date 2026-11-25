import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHlsAttributes,
  parseHlsMaster,
  sortHlsQualityOptions,
} from "../../lib/hls-master.ts";

test("should parse quoted HLS attributes without retaining quotes", () => {
  assert.deepEqual(
    parseHlsAttributes(
      'BANDWIDTH=8242502,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
    ),
    {
      BANDWIDTH: "8242502",
      RESOLUTION: "1920x1080",
      CODECS: "avc1.640028,mp4a.40.2",
    },
  );
});

test("should parse and rank a master manifest without mutating its input list", () => {
  const source = [{ label: "480p" }, { label: "1080p" }];

  assert.deepEqual(
    sortHlsQualityOptions(source).map((item) => item.label),
    ["1080p", "480p"],
  );

  assert.deepEqual(
    source.map((item) => item.label),
    ["480p", "1080p"],
  );

  const master = parseHlsMaster(
    `#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="captions/pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=8242502,RESOLUTION=1920x1080\n1080p/video.m3u8`,
    "https://cdn.example/course/master.m3u8",
  );

  assert.equal(master.isMaster, true);

  assert.equal(
    master.qualityOptions[0]?.url,
    "https://cdn.example/course/1080p/video.m3u8",
  );

  assert.deepEqual(master.subtitles[0], {
    url: "https://cdn.example/course/captions/pt.vtt",
    label: "Portuguese",
    language: "pt-BR",
  });
});

test("should handle BOM, CRLF, comments, relative paths, and bandwidth-only options", () => {
  const master = parseHlsMaster(
    "\uFEFF#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=999000\r\n# a comment\r\nlow/video.m3u8\r\n#EXT-X-STREAM-INF:BANDWIDTH=2000,RESOLUTION=640x360\r\n360/video.m3u8\r\n",
    "https://cdn.example/root/master.m3u8",
  );

  assert.equal(master.isMaster, true);

  assert.deepEqual(master.qualityOptions, [
    { url: "https://cdn.example/root/low/video.m3u8", label: "999 kbps" },
    { url: "https://cdn.example/root/360/video.m3u8", label: "360p (640×360)" },
  ]);
});

test("should return only declared subtitle tracks with a URI and freeze returned collections", () => {
  const master = parseHlsMaster(
    "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=audio.m3u8\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME=NoUri\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE=en,URI=subs/en.vtt\n",
    "https://cdn.example/master.m3u8",
  );

  assert.equal(master.isMaster, false);

  assert.deepEqual(master.subtitles, [
    { url: "https://cdn.example/subs/en.vtt", label: "en", language: "en" },
  ]);

  assert.equal(Object.isFrozen(master), true);
  assert.equal(Object.isFrozen(master.qualityOptions), true);
  assert.equal(Object.isFrozen(master.subtitles), true);
});

test("should reject malformed quoted attributes and stream tags without a following URI", () => {
  assert.deepEqual(parseHlsAttributes('NAME="Portuguese"'), {
    NAME: "Portuguese",
  });

  const master = parseHlsMaster(
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs.vtt"',
    "https://cdn.example/master.m3u8",
  );

  assert.equal(master.isMaster, false);

  assert.deepEqual(master.subtitles, [
    {
      url: "https://cdn.example/subs.vtt",
      label: "Subtitle",
      language: "",
    },
  ]);

  const dualProfileMaster = parseHlsMaster(
    [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
      "playlist_0.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720",
      "playlist_1.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=5400000,RESOLUTION=1920x1080",
      "playlist_2.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480",
      "playlist_3.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=2100000,RESOLUTION=1280x720",
      "playlist_4.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080",
      "playlist_5.m3u8",
    ].join("\n"),
    "https://cdn.example/video/hls/playlist.m3u8",
  );

  assert.deepEqual(
    dualProfileMaster.qualityOptions.map((item) => item.label),
    ["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"],
  );
});
