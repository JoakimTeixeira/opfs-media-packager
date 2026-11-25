import test from "node:test";
import assert from "node:assert/strict";
import { createMediaRequest } from "../../lib/media-request.ts";
import { parseHlsMaster } from "../../lib/hls-master.ts";

const renditionMaster = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2453767,RESOLUTION=854x480
480p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4733502,RESOLUTION=1280x720
720p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1436690,RESOLUTION=640x360
360p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1066168,RESOLUTION=426x240
240p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8242502,RESOLUTION=1920x1080
1080p/video.m3u8
`;

test("should integrate a referrer-aware master response into a quality ladder", async () => {
  const lessonUrl =
    "https://training.example/courses/course/lessons/1?chapter=1";

  const mediaUrl = "https://media.example.net/course/master.m3u8";

  const requestInit = createMediaRequest({
    mediaUrl,
    sourcePageUrl: lessonUrl,
  });

  assert.equal(requestInit.referrerPolicy, "unsafe-url");
  assert.equal(requestInit.referrer, lessonUrl);

  const respond = (init: RequestInit): Response => {
    const referrer = init.referrer ?? "";

    const effectiveReferrer =
      init.referrerPolicy === "unsafe-url"
        ? referrer
        : `${new URL(referrer).origin}/`;

    if (effectiveReferrer !== lessonUrl) {
      return new Response("Forbidden", { status: 403 });
    }

    return new Response(renditionMaster, {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  };

  const originOnly = respond({
    referrer: lessonUrl,
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  assert.equal(originOnly.status, 403);

  const authorized = respond(requestInit);

  assert.equal(authorized.status, 200);
  const parsed = parseHlsMaster(await authorized.text(), mediaUrl);

  assert.deepEqual(
    parsed.qualityOptions.map((option) => option.label),
    [
      "1080p (1920×1080)",
      "720p (1280×720)",
      "480p (854×480)",
      "360p (640×360)",
      "240p (426×240)",
    ],
  );
});
