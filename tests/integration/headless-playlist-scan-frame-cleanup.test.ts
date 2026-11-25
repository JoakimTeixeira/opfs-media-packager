import test from "node:test";
import assert from "node:assert/strict";
import {
  COURSE_ORIGIN,
  type ApiLesson,
  stringField,
  EXT_ID,
  probeLessons,
} from "./fixtures/headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./fixtures/headless-playlist-scan-setup.ts";

test("Tier 1.5 closes a linked-post firstRun frame, opens a clean course frame for sidebar lessons, and aborts cleanly when navigate-course-sidebar fails", async () => {
  harness.reset();
  const sourceTabId = 48;
  const playlistUrl = `${COURSE_ORIGIN}/c/sample-course/sections/1/lessons/10`;
  const linkedEventUrl = `${COURSE_ORIGIN}/c/events/sample-event-1`;
  const linkedMp4Url = "https://assets.example.net/sample-event-1.mp4";
  const sidebar104Url = "https://media.example.net/lesson-104/playlist.m3u8";
  const sidebar901Url = "https://media.example.net/lesson-901/playlist.m3u8";

  const lessons: readonly ApiLesson[] = [
    {
      id: "current-item",
      url: playlistUrl,
      fileTitle: "1.1 Introdução",
      folderPath: ["(Playlist) Sample Course", "1. Introdução"],
      navigationIndex: -1,
    },
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.3 O que vai ser construido",
      folderPath: ["(Playlist) Sample Course", "1. Introdução"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "1.4 Notas recursos exemplos",
      folderPath: ["(Playlist) Sample Course", "1. Introdução"],
      navigationIndex: 1,
    },
    {
      id: "btn-2",
      url: playlistUrl,
      fileTitle: "9.1 Introdução",
      folderPath: ["(Playlist) Sample Course", "9. Modulo Evolutivo"],
      navigationIndex: 2,
    },
    {
      id: "btn-3",
      url: playlistUrl,
      fileTitle: "10.1 Aula Inacessivel",
      folderPath: ["(Playlist) Sample Course", "10. Pronto para Producao"],
      navigationIndex: 3,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Sample Course",
  });

  await harness.chromeMock.storage.session.set({
    [`detections:${sourceTabId}`]: {
      pageUrl: playlistUrl,
      streams: [
        {
          key: "https://media.example.net/lesson-101/",
          url: "https://media.example.net/lesson-101/playlist.m3u8",
          host: "media.example.net",
          title: "1.1 Introdução",
          sourceUrl: playlistUrl,
          kind: "master",
          qualityOptions: [
            {
              url: "https://media.example.net/lesson-101/1080p/video.m3u8",
              label: "1080p",
            },
          ],
          subtitles: [
            {
              url: "https://media.example.net/lesson-101/pt.vtt",
              label: "Portuguese",
              language: "Portuguese",
            },
          ],
          detectedAt: Date.now(),
        },
      ],
      subtitles: [],
    },
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
          "1080p/video.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
          "720p/video.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
          "480p/video.m3u8",
        ].join("\n"),
        { status: 200 },
      ),
  );

  const probeState = {
    linkedFrameId: 201,
    courseFrameId: 202,
    openedUrls: [] as string[],
    closedProbeIds: [] as string[],
    probeLessonFrames: [] as number[],
    navigatedSections: [] as string[],
    extractedMaterialFrames: [] as number[],
    collectedDirectFrames: [] as number[],
  };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      probeState.probeLessonFrames.push(options.frameId ?? 0);
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: playlistUrl,
      };

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: { 1: linkedEventUrl },
            unresolvedLinkLists: { 1: [linkedEventUrl] },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const isLinked = targetUrl === linkedEventUrl;

      const frameId = isLinked
        ? probeState.linkedFrameId
        : probeState.courseFrameId;

      probeState.openedUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (isLinked) {
          await harness.sendRuntimeMessage(
            {
              type: "page-playlist-stream",
              stream: { url: "", mediaUrl: linkedMp4Url },
            },
            { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
          );
        }
      });

      return { ok: true };
    }

    if (message.type === "close-hidden-probe-frame") {
      probeState.closedProbeIds.push(stringField(message, "probeId"));

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === probeState.courseFrameId
    ) {
      probeState.navigatedSections.push(stringField(message, "itemSection"));
      const navIndex = message.itemIndex;

      if (navIndex === 3) return { ok: false };

      queueMicrotask(() => {
        harness.emitWebRequest({
          tabId,
          frameId: probeState.courseFrameId,
          parentFrameId: 0,
          statusCode: 200,
          url: navIndex === 1 ? sidebar104Url : sidebar901Url,
        });
      });

      return { ok: true };
    }

    if (message.type === "collect-direct-video") {
      probeState.collectedDirectFrames.push(options.frameId ?? -1);

      return { url: "" };
    }

    if (message.type === "extract-item-documents") {
      probeState.extractedMaterialFrames.push(options.frameId ?? -1);

      if (options.frameId === probeState.linkedFrameId) {
        return {
          documents: {
            markdown: "# Linked Event\n",
            images: [
              {
                kind: "image",
                url: "https://assets.example.net/linked-cover.png",
                filename: "linked-cover.png",
              },
            ],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        };
      }

      return {
        documents: {
          markdown: "# Normal Sidebar Lesson\n",
          images: [],
          pdfs: [],
          diagrams: [],
          slides: [],
        },
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sample Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 5);
  assert.deepEqual(probeState.probeLessonFrames, [0]);
  assert.deepEqual(probeState.openedUrls, [linkedEventUrl, playlistUrl]);
  assert.equal(probeState.closedProbeIds.length, 2);

  assert.deepEqual(probeState.navigatedSections, [
    "1. Introdução",
    "9. Modulo Evolutivo",
    "10. Pronto para Producao",
  ]);

  // Failed navigation for lesson 4 (10.1) aborted cleanly without scraping materials/direct video.
  assert.deepEqual(probeState.extractedMaterialFrames, [0, 201, 202, 202]);
  assert.deepEqual(probeState.collectedDirectFrames, []);
  assert.equal(scan.discovered.length, 4);

  const lesson104 = scan.discovered.find((item) => item.itemIndex === 2);
  const lesson901 = scan.discovered.find((item) => item.itemIndex === 3);

  assert.equal(lesson104?.url, sidebar104Url);
  assert.equal(lesson104?.qualityOptions?.length, 3);
  assert.equal(lesson104?.documents?.images.length, 0);
  assert.equal(lesson901?.url, sidebar901Url);
  assert.equal(lesson901?.qualityOptions?.length, 3);
});
