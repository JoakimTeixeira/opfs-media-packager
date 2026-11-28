import { test, assert } from "vitest";
import { syntheticOpaqueAssetUrl } from "../../../lib/materials/__fixtures__/attachment-tokens.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./__mocks__/headless-track-scan-setup.ts";
import {
  COURSE_ORIGIN,
  EXT_ID,
} from "./__mocks__/headless-track-scan-types.ts";

test("should resolve embedded video players with separate HLS audio, VTT subtitles, and attached documents across single-page and Tier 1 playlist flows", async () => {
  harness.reset();
  const sourceTabId = 77;
  const pageUrl = `${COURSE_ORIGIN}/c/sample-track/sections/700/lessons/2001`;
  const embedUrl = "https://player.vimeo.com/video/900001001?app_id=990001";

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: pageUrl,
    title: "Sample Track",
  });

  const embedHtml = `<!doctype html><html><script>
    window.playerConfig = {
      "video": { "title": "Sample Lesson One" },
      "request": {
        "files": {
          "hls": {
            "default_cdn": "akfire",
            "cdns": {
              "akfire": { "url": "https://cdn.example.net/sep/master.m3u8" }
            }
          }
        },
        "text_tracks": [
          { "url": "/texttrack/901.vtt", "lang": "en-US", "label": "English" }
        ]
      }
    };
  </script></html>`;

  const masterM3u8 = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080,AUDIO="audio-high"',
    "video/1080p.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=2100000,RESOLUTION=1280x720,AUDIO="audio-high"',
    "video/720p.m3u8",
  ].join("\n");

  harness.setFetchHandler(async (url) => {
    if (url.startsWith("https://player.vimeo.com/video/900001001")) {
      return new Response(embedHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://cdn.example.net/sep/master.m3u8") {
      return new Response(masterM3u8, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }

    return new Response("Not found", { status: 404 });
  });

  const pageSender = {
    id: EXT_ID,
    tab: { id: sourceTabId },
    frameId: 0,
    url: pageUrl,
  };

  // 1. Single-page detection: page-track-stream (embedUrl) + page-topic-documents.
  const streamResult = await harness.sendRuntimeMessage(
    {
      type: "page-track-stream",
      stream: { url: "", mediaUrl: "", embedUrl },
    },
    pageSender,
  );

  assert.strictEqual(streamResult?.ok, true);

  const documentsResult = await harness.sendRuntimeMessage(
    {
      type: "page-topic-documents",
      sourceUrl: pageUrl,
      documents: {
        markdown: "# Sample Lesson One\n",
        images: [],
        pdfs: [],
        files: [
          {
            kind: "pptx",
            url: syntheticOpaqueAssetUrl("scan-sample-deck"),
            filename: "Sample Deck.pptx",
            contentType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
        ],
        diagrams: [],
        slides: [],
      },
    },
    pageSender,
  );

  assert.strictEqual(documentsResult?.ok, true);

  const detections = (await harness.sendRuntimeMessage(
    { type: "list-detections", tabId: sourceTabId },
    extSender,
  )) as {
    readonly streams?: readonly {
      readonly url: string;
      readonly title: string;
      readonly qualityOptions: readonly {
        readonly url: string;
        readonly label: string;
        readonly audioUri?: string;
      }[];
    }[];
    readonly subtitles?: readonly {
      readonly url: string;
      readonly language: string;
    }[];
    readonly documents?: {
      readonly files?: readonly {
        readonly kind: string;
        readonly filename: string;
      }[];
    };
  };

  assert.strictEqual(
    detections?.streams?.[0]?.url,
    "https://cdn.example.net/sep/master.m3u8",
  );

  assert.strictEqual(
    detections?.streams?.[0]?.qualityOptions?.[0]?.audioUri,
    "https://cdn.example.net/sep/audio/index.m3u8",
  );

  assert.strictEqual(
    detections?.subtitles?.[0]?.url,
    "https://player.vimeo.com/texttrack/901.vtt",
  );

  assert.strictEqual(detections?.subtitles?.[0]?.language, "English (US)");
  assert.strictEqual(detections?.documents?.files?.[0]?.kind, "pptx");

  // 2. Tier 1 headless playlist scan: item 0 seeded from active tab, item 1 probed via Tier 1 embedUrl + files.
  const secondLessonUrl = `${COURSE_ORIGIN}/c/sample-track/sections/700/lessons/2002`;

  harness.setTabMessageHandler(async (_tabId, message) => {
    if (message.type === "probe-track-topics") {
      const requestId =
        typeof message.requestId === "string" ? message.requestId : "";

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "track-topic-probed",
            requestId,
            topicIndex: 1,
            stream: {
              url: "",
              mediaUrl: "",
              embedUrl,
              sourceUrl: secondLessonUrl,
              documents: {
                markdown: "# Sample Lesson Two\n",
                images: [],
                pdfs: [],
                files: [
                  {
                    kind: "docx",
                    url: syntheticOpaqueAssetUrl("scan-sample-notes"),
                    filename: "Sample Notes.docx",
                  },
                ],
                diagrams: [],
                slides: [],
              },
            },
          },
          pageSender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "track-topics-probe-done",
            requestId,
            unresolvedIndices: [],
            unresolvedLinks: {},
          },
          pageSender,
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-track-scan",
      sourceTabId,
      outline: {
        title: "Sample Track",
        items: [
          {
            id: "2001",
            url: pageUrl,
            fileTitle: "1.1 Lesson One",
            folderPath: ["(Track) Sample Track", "1. Module One"],
          },
          {
            id: "2002",
            url: secondLessonUrl,
            fileTitle: "1.2 Lesson Two",
            folderPath: ["(Track) Sample Track", "1. Module One"],
          },
        ],
      },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.strictEqual(scan?.status, "ready");
  assert.strictEqual(scan?.discovered.length, 2);

  const discoveredByIndex = new Map(
    (scan?.discovered ?? []).map((entry) => [entry.topicIndex, entry]),
  );

  assert.strictEqual(
    discoveredByIndex.get(0)?.url,
    "https://cdn.example.net/sep/master.m3u8",
  );

  assert.strictEqual(
    discoveredByIndex.get(0)?.documents?.files?.[0]?.kind,
    "pptx",
  );

  assert.strictEqual(
    discoveredByIndex.get(1)?.url,
    "https://cdn.example.net/sep/master.m3u8",
  );

  assert.strictEqual(
    discoveredByIndex.get(1)?.subtitles[0]?.language,
    "English (US)",
  );

  assert.strictEqual(
    discoveredByIndex.get(1)?.documents?.files?.[0]?.kind,
    "docx",
  );

  assert.strictEqual(harness.calls.windowsCreated.length, 0);
});
