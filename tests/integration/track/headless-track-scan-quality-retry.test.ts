import { test, assert } from "vitest";
import {
  COURSE_ORIGIN,
  type ApiLesson,
  stringField,
  probeLessons,
  EXT_ID,
} from "./__mocks__/headless-track-scan-types.ts";
import { realSetTimeout } from "./__mocks__/headless-track-scan-harness.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./__mocks__/headless-track-scan-setup.ts";

test("Tier 1.5 preserves all 3 quality options across wildcard-CORS credentials:omit retry and trailing rendition playlist", async () => {
  harness.reset();
  const sourceTabId = 43;
  const playlistUrl = `${COURSE_ORIGIN}/c/ai/sections/1/lessons/10`;
  const masterUrl = "https://cdn.example.net/video-99/master.m3u8";
  const renditionUrl = "https://cdn.example.net/video-99/rendition-0.m3u8";
  const transcriptUrl = `${COURSE_ORIGIN}/media_transcripts/99.vtt`;

  const lessons: readonly ApiLesson[] = [
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.1 Fundamentos",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 0,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Playlist",
  });

  const fetchOrder: string[] = [];

  // Wildcard-ACAO CDN rejects credentials:"include" with TypeError and succeeds with credentials:"omit".
  harness.setFetchHandler(async (input, init) => {
    const url = String(input);

    if (init?.credentials === "include") {
      throw new TypeError("Failed to fetch");
    }

    if (url === masterUrl) {
      fetchOrder.push("master");

      // Trigger the trailing rendition ONLY after master has been fetched so
      // onStream(master) deterministically runs before onStream(rendition).
      realSetTimeout(() => {
        harness.emitWebRequest({
          tabId: sourceTabId,
          frameId: 77,
          parentFrameId: 0,
          statusCode: 200,
          url: renditionUrl,
        });
      }, 4);

      return new Response(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
          "rendition-1080.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720",
          "rendition-720.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
          "rendition-480.m3u8",
        ].join("\n"),
        { status: 200 },
      );
    }

    if (url === renditionUrl) {
      fetchOrder.push("rendition");

      return new Response(
        "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg0.ts\n#EXT-X-ENDLIST\n",
        { status: 200 },
      );
    }

    if (url === transcriptUrl) {
      return new Response(
        "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOlá pessoal, você está vendo esta aula sobre desenvolvimento com IA.\n",
        { status: 200 },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-track-topics") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "track-topics-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.topicIndex),
            unresolvedLinks: {},
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: options.frameId ?? 0,
            url: playlistUrl,
          },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "hidden-probe-frame-ready",
            probeId: stringField(message, "probeId"),
          },
          { id: EXT_ID, tab: { id: tabId }, frameId: 77, url: playlistUrl },
        );
      });

      return { ok: true };
    }

    if (message.type === "navigate-track-sidebar" && options.frameId === 77) {
      queueMicrotask(() => {
        harness.emitWebRequest({
          tabId,
          frameId: 77,
          parentFrameId: 0,
          statusCode: 200,
          url: masterUrl,
        });
      });

      return { ok: true };
    }

    if (message.type === "collect-page-subtitles" && options.frameId === 77) {
      return {
        tracks: [{ url: transcriptUrl, language: "Subtitle", label: "" }],
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-track-scan",
      sourceTabId,
      outline: { title: "Wildcard CORS Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 5000);

  assert.ok(scan);
  assert.strictEqual(scan.status, "ready");
  assert.strictEqual(scan.discovered.length, 1);
  assert.deepStrictEqual(fetchOrder, ["master", "rendition"]);

  const discovered = scan.discovered[0];

  assert.strictEqual(discovered.url, masterUrl);
  assert.strictEqual(discovered.kind, "master");

  assert.deepStrictEqual(
    discovered.qualityOptions?.map((option) => option.label),
    ["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"],
  );

  assert.strictEqual(discovered.subtitles[0]?.language, "Portuguese");
});
