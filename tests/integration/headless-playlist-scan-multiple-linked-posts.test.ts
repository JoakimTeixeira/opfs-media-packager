import test from "node:test";
import assert from "node:assert/strict";
import {
  COURSE_ORIGIN,
  type ApiLesson,
  stringField,
  EXT_ID,
} from "./fixtures/headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./fixtures/headless-playlist-scan-setup.ts";

test("Tier 1.5 probes multiple linked posts sequentially, keeps parent Markdown & images intact, and appends distinct extraVideos and extraNotes", async () => {
  harness.reset();
  const sourceTabId = 46;
  const lesson0Url = `${COURSE_ORIGIN}/c/sample-course/sections/1/lessons/10`;
  const lesson1Url = `${COURSE_ORIGIN}/c/sample-course/sections/1/lessons/20`;
  const post1Url = `${COURSE_ORIGIN}/c/events/reading-group`;
  const post2Url = `${COURSE_ORIGIN}/c/community/sample-lesson`;
  const post3Url = `${COURSE_ORIGIN}/c/notes/pattern-notes`;

  const lessons: readonly ApiLesson[] = [
    {
      id: "10",
      url: lesson0Url,
      fileTitle: "1.1 YouTube Only Lesson",
      folderPath: ["(Playlist) Sample Track", "1. Module 1"],
    },
    {
      id: "20",
      url: lesson1Url,
      fileTitle: "1.2 Workflow Patterns",
      folderPath: ["(Playlist) Sample Track", "1. Module 1"],
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lesson0Url,
    title: "Sample Track",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const openedFrameUrls: string[] = [];

  const frameMaterialsById = new Map<number, Record<string, unknown>>([
    [
      91,
      {
        markdown: "# Reading Group - Patterns\n\nLive session notes.\n",
        images: [],
        pdfs: [],
        diagrams: [
          {
            kind: "diagram",
            url: "https://app.excalidraw.com/l/room/patterns",
            title: "Patterns Diagram",
          },
        ],
        slides: [],
      },
    ],
    [
      92,
      {
        markdown:
          "# Sample Lesson Video\n\nRepo: https://github.com/org/sample-repo\n",
        images: [],
        pdfs: [],
        diagrams: [],
        slides: [],
      },
    ],
    [
      93,
      {
        markdown: "# Pattern Notes\n\nComparison table notes.\n",
        images: [
          {
            kind: "image",
            url: "https://assets.example.net/pattern-comparison.png",
            filename: "pattern-comparison.png",
          },
        ],
        pdfs: [],
        diagrams: [],
        slides: [],
      },
    ],
  ]);

  const headingsByFrameId = new Map<number, string>([
    [91, "Reading Group - Patterns"],
    [92, "Sample Lesson Video"],
    [93, "Pattern Notes"],
  ]);

  const playlistByUrl = new Map<string, { frameId: number; url: string }>([
    [
      post1Url,
      {
        frameId: 91,
        url: "https://media.example.net/pattern-group-1/playlist.m3u8",
      },
    ],
    [
      post2Url,
      {
        frameId: 92,
        url: "https://media.example.net/pattern-lesson-2/playlist.m3u8",
      },
    ],
  ]);

  const frameIdByUrl = new Map<string, number>([
    [post1Url, 91],
    [post2Url, 92],
    [post3Url, 93],
  ]);

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: lesson0Url,
      };

      queueMicrotask(async () => {
        // Lesson 0: YouTube lesson resolved completely in Tier 1.
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            stream: {
              url: "",
              mediaUrl: "",
              subtitles: [],
              sourceUrl: lesson0Url,
              documents: {
                markdown:
                  "# 1.1 YouTube Only Lesson\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n",
                images: [],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        // Lesson 1: partial parent materials emitted BEFORE Tier 1.5 probes 3 linked posts.
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 1,
            partial: true,
            stream: {
              url: "",
              mediaUrl: "",
              subtitles: [],
              sourceUrl: lesson1Url,
              documents: {
                markdown: [
                  "# 1.2 Workflow Patterns",
                  "",
                  `[Reading Group](${post1Url})`,
                  "",
                  `[Sample Lesson](${post2Url})`,
                  "",
                  `[Pattern Notes](${post3Url})`,
                  "",
                ].join("\n"),
                images: [
                  {
                    kind: "image",
                    url: "https://assets.example.net/parent-img-1.png",
                    filename: "parent-img-1.png",
                  },
                ],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [1],
            unresolvedLinks: { 1: post1Url },
            unresolvedLinkLists: { 1: [post1Url, post2Url, post3Url] },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const frameId = frameIdByUrl.get(targetUrl) ?? 90;

      openedFrameUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        const playlist = playlistByUrl.get(targetUrl);

        if (playlist) {
          harness.emitWebRequest({
            tabId,
            frameId: playlist.frameId,
            parentFrameId: 0,
            statusCode: 200,
            url: playlist.url,
          });
        }
      });

      return { ok: true };
    }

    if (message.type === "get-page-heading") {
      const title = headingsByFrameId.get(options.frameId ?? -1);

      if (title) return { title };
    }

    if (message.type === "extract-item-documents") {
      const documents = frameMaterialsById.get(options.frameId ?? -1);

      if (documents) return { documents };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sample Track", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 2);
  assert.deepEqual(openedFrameUrls, [post1Url, post2Url, post3Url]);
  assert.equal(scan.discovered.length, 2);

  const ytLesson = scan.discovered.find((item) => item.itemIndex === 0);

  assert.ok(ytLesson?.documents?.markdown.includes("youtube.com/watch?v="));

  const multiLesson = scan.discovered.find((item) => item.itemIndex === 1);

  assert.ok(multiLesson);
  assert.equal(multiLesson.title, "1.2 Workflow Patterns");
  assert.equal(multiLesson.primaryVideoTitle, "1.2 Reading Group - Patterns");

  assert.equal(
    multiLesson.url,
    "https://media.example.net/pattern-group-1/playlist.m3u8",
  );

  assert.equal(multiLesson.extraVideos?.length, 1);

  assert.equal(multiLesson.extraVideos?.[0]?.title, "1.2 Sample Lesson Video");

  assert.equal(
    multiLesson.extraVideos?.[0]?.url,
    "https://media.example.net/pattern-lesson-2/playlist.m3u8",
  );

  assert.equal(multiLesson.documents?.images.length, 2);
  assert.equal(multiLesson.documents?.diagrams.length, 1);
  assert.equal(multiLesson.documents?.extraNotes?.length, 3);

  assert.match(
    multiLesson.documents?.markdown || "",
    /^# 1\.2 Workflow Patterns/,
  );

  assert.ok(
    multiLesson.documents?.extraNotes?.some((note) =>
      note.markdown.includes("https://github.com/org/sample-repo"),
    ),
  );
});
