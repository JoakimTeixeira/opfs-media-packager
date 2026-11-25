import test from "node:test";
import assert from "node:assert/strict";
import {
  COURSE_ORIGIN,
  stringField,
  EXT_ID,
  type MessageSender,
  type DiscoveredQualityOption,
} from "./mocks/headless-playlist-scan-types.ts";
import { harness, extSender } from "./mocks/headless-playlist-scan-setup.ts";

test("list-detections recovers empty quality options via course page fallback and course-outline never downgrades 21 lessons to 2", async () => {
  harness.reset();
  const tabId = 44;
  const playlistUrl = `${COURSE_ORIGIN}/c/ai/sections/98/lessons/3727`;
  const manifestUrl = "https://cdn.example.net/asset-44/hls/playlist.m3u8";

  harness.tabs.set(tabId, {
    id: tabId,
    url: playlistUrl,
    title: "IA First Dev",
  });

  // Seed a stream whose initial inspection failed and left 0 quality options.
  await harness.chromeMock.storage.session.set({
    [`detections:${tabId}`]: {
      pageUrl: playlistUrl,
      streams: [
        {
          key: "https://cdn.example.net/asset-44/hls/",
          url: manifestUrl,
          host: "cdn.example.net",
          title: "Introdução ao Curso de Exemplo",
          sourceUrl: playlistUrl,
          kind: "media",
          qualityOptions: [],
          subtitles: [],
          detectedAt: Date.now(),
        },
      ],
      subtitles: [],
    },
  });

  // Service worker fetches fail (e.g. strict CDN rejecting extension origin), so page fallback must succeed.
  harness.setFetchHandler(
    async () => new Response("Forbidden", { status: 403 }),
  );

  harness.setTabMessageHandler(async (id, message) => {
    if (message.type === "fetch-media-from-page") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "page-media-result",
            requestId: stringField(message, "requestId"),
            response: {
              status: 200,
              body: [
                "#EXTM3U",
                "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
                "1080p/video.m3u8",
                "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
                "720p/video.m3u8",
                "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
                "480p/video.m3u8",
              ].join("\n"),
            },
          },
          { id: EXT_ID, tab: { id }, frameId: 0, url: playlistUrl },
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const pageSender: MessageSender = {
    id: EXT_ID,
    tab: { id: tabId },
    frameId: 0,
    url: playlistUrl,
  };

  // Publish full 21-lesson outline, then attempt to overwrite with a partial 2-lesson outline on the same URL.
  await harness.sendRuntimeMessage(
    {
      type: "playlist-outline",
      outline: {
        title: "IA First Dev",
        items: Array.from({ length: 21 }, (_, idx) => ({
          id: `sidebar-${idx}`,
          url: playlistUrl,
          fileTitle: `1.${idx + 1} Lesson ${idx + 1}`,
          folderPath: ["1. IA First Dev", "1. Module"],
          navigationIndex: idx === 0 ? -1 : idx - 1,
        })),
      },
    },
    pageSender,
  );

  await harness.sendRuntimeMessage(
    {
      type: "playlist-outline",
      outline: {
        title: "IA First Dev",
        items: Array.from({ length: 2 }, (_, idx) => ({
          id: `stray-${idx}`,
          url: `${COURSE_ORIGIN}/c/ai/sections/98/lessons/${idx + 1}`,
          fileTitle: `1.${idx + 1} Stray ${idx + 1}`,
          folderPath: ["1. IA First Dev", "1. Section"],
        })),
      },
    },
    pageSender,
  );

  const listed = (await harness.sendRuntimeMessage(
    { type: "list-detections", tabId },
    extSender,
  )) as {
    readonly streams?: readonly {
      readonly kind: string;
      readonly qualityOptions: readonly DiscoveredQualityOption[];
    }[];
    readonly playlistOutline?: { readonly items: readonly unknown[] };
  };

  assert.equal(listed?.playlistOutline?.items?.length, 21);
  assert.equal(listed?.streams?.[0]?.kind, "master");

  assert.deepEqual(
    listed?.streams?.[0]?.qualityOptions.map((option) => option.label),
    ["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"],
  );
});
