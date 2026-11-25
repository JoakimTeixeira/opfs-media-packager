import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures/extension.ts";
import { generateTinyTsSegment } from "./fixtures/download-page-fixtures.ts";
import { startMaterialsE2eServer } from "./fixtures/download-page-materials-server.ts";

test("should download multi-video and multi-note lessons alongside YouTube-only Markdown lessons from the course playlist", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
  const segmentBuffer = await generateTinyTsSegment(setupPage);
  const server = await startMaterialsE2eServer(segmentBuffer);
  const baseUrl = `http://materials.example.test:${server.port}`;
  const excalidrawUrl = `http://e2e.excalidraw.com:${server.port}/s/test-room/scene-1`;

  try {
    const scanId = "e2e-multi-post-scan";

    await setupPage.evaluate(
      async ({ diagramUrl, id, origin }) => {
        await chrome.storage.session.set({
          [`playlist-scan:${id}`]: {
            id,
            title: "Sample Architecture Track",
            status: "ready",
            rateLimited: false,
            nextItemIndex: 2,
            currentItemIndex: null,
            sourceTabId: null,
            startedAt: Date.now(),
            items: [
              {
                id: "901",
                url: "https://training.example/c/sample-course/sections/1/lessons/901",
                fileTitle: "1.1 Streaming Notes",
                folderPath: ["(Playlist) Sample Track", "1. Secao"],
              },
              {
                id: "902",
                url: "https://training.example/c/sample-course/sections/1/lessons/902",
                fileTitle: "1.2 Workflow Patterns",
                folderPath: ["(Playlist) Sample Track", "1. Secao"],
              },
            ],
            discovered: [
              {
                key: "documents:0",
                url: "",
                host: "",
                title: "1.1 Streaming Notes",
                sourceUrl:
                  "https://training.example/c/sample-course/sections/1/lessons/901",
                kind: "media",
                qualityOptions: [],
                subtitles: [],
                detectedAt: Date.now(),
                folderPath: ["(Playlist) Sample Track", "1. Secao"],
                itemIndex: 0,
                documents: {
                  markdown:
                    "# 1.1 Streaming Notes\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid22222222)\n\nRepo: https://github.com/org/ws\n",
                  images: [],
                  pdfs: [],
                  diagrams: [],
                  slides: [],
                },
              },
              {
                key: "multi-pat-1",
                url: `${origin}/video/playlist.m3u8`,
                host: `materials.example.test:${new URL(origin).port}`,
                title: "1.2 Workflow Patterns",
                primaryVideoTitle: "1.2 Reading Group Patterns",
                sourceUrl: "https://training.example/c/events/reading-group",
                kind: "media",
                qualityOptions: [
                  { url: `${origin}/video/playlist.m3u8`, label: "720p" },
                ],
                subtitles: [
                  {
                    url: `${origin}/video/mojibake.vtt`,
                    language: "Portuguese",
                    label: "Portuguese",
                  },
                ],
                extraVideos: [
                  {
                    key: "multi-pat-2",
                    url: `${origin}/video/playlist.m3u8?v=2`,
                    host: `materials.example.test:${new URL(origin).port}`,
                    title: "1.2 Sample Lesson Video",
                    sourceUrl:
                      "https://training.example/c/community/sample-lesson",
                    kind: "media",
                    qualityOptions: [
                      {
                        url: `${origin}/video/playlist.m3u8?v=2`,
                        label: "720p",
                      },
                    ],
                    subtitles: [
                      {
                        url: `${origin}/video/mojibake.vtt`,
                        language: "Portuguese",
                        label: "Portuguese",
                      },
                    ],
                  },
                ],
                detectedAt: Date.now(),
                folderPath: ["(Playlist) Sample Track", "1. Secao"],
                itemIndex: 1,
                documents: {
                  markdown: [
                    "# 1.2 Workflow Patterns",
                    "",
                    "[Reading Group](https://training.example/c/events/reading-group)",
                    "",
                    "[Sample Lesson](https://training.example/c/community/sample-lesson)",
                    "",
                    "[Pattern Notes](https://training.example/c/notes/pattern-notes)",
                    "",
                    `[Diagrama](${diagramUrl})`,
                    "",
                  ].join("\n"),
                  images: [
                    {
                      kind: "image",
                      url: `${origin}/redirect-img`,
                      filename: "Pattern Table.png",
                      contentType: "image/png",
                    },
                  ],
                  pdfs: [],
                  diagrams: [
                    {
                      kind: "diagram",
                      url: diagramUrl,
                      title: "Pattern Map",
                    },
                  ],
                  slides: [],
                  extraNotes: [
                    {
                      title: "Sample Lesson Video",
                      sourceUrl:
                        "https://training.example/c/community/sample-lesson",
                      markdown:
                        "# Sample Lesson Video\n\nRepo: [Código](https://github.com/org/sample-repo)\n",
                    },
                    {
                      title: "Pattern Notes",
                      sourceUrl:
                        "https://training.example/c/notes/pattern-notes",
                      markdown: "# Pattern Notes\n\nComparativo final.\n",
                    },
                  ],
                },
              },
            ],
          },
        });
      },
      { diagramUrl: excalidrawUrl, id: scanId, origin: baseUrl },
    );

    const coursePage = await context.newPage();
    const cdp = await context.newCDPSession(setupPage);

    await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

    try {
      await coursePage.goto(
        `chrome-extension://${extensionId}/playlist.html?scan=${scanId}`,
      );

      await expect(coursePage.locator("#selection-count")).toHaveText(
        "2 of 2 items selected",
      );

      await expect(coursePage.locator(".item-meta").nth(1)).toContainText(
        "2 videos · Portuguese · MD · 1 image · 1 diagram",
      );

      const queuePagePromise = context.waitForEvent("page");

      await coursePage.click("#download-all");
      const queuePage = await queuePagePromise;

      try {
        await expect(queuePage.locator("#message")).toHaveText(
          "Playlist download finished",
          { timeout: 30000 },
        );

        const lessonFolder = join(
          downloadsDir,
          "HLS Videos",
          "(Playlist) Sample Track",
          "1. Secao",
        );

        const files = await readdir(lessonFolder);

        expect(files).toContain("1.1 Streaming Notes.md");
        expect(files).toContain("1.2 Reading Group Patterns.mp4");
        expect(files).toContain("1.2 Reading Group Patterns.vtt");
        expect(files).toContain("1.2 Sample Lesson Video.mp4");
        expect(files).toContain("1.2 Sample Lesson Video.vtt");
        expect(files).toContain("1.2 Sample Lesson Video.md");
        expect(files).toContain("1.2 Pattern Notes.md");
        expect(files).toContain("1.2 Pattern Table.png");
        expect(files).toContain("1.2 Pattern Map.svg");
        expect(files).toContain("1.2 Workflow Patterns.md");

        const ytMd = await readFile(
          join(lessonFolder, "1.1 Streaming Notes.md"),
          "utf8",
        );

        expect(ytMd).toContain(
          "**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid22222222)",
        );

        const aulaMd = await readFile(
          join(lessonFolder, "1.2 Sample Lesson Video.md"),
          "utf8",
        );

        expect(aulaMd).toContain(
          "[Código](https://github.com/org/sample-repo)",
        );

        const parentMd = await readFile(
          join(lessonFolder, "1.2 Workflow Patterns.md"),
          "utf8",
        );

        expect(parentMd).toContain(
          "[Reading Group](https://training.example/c/events/reading-group) — Baixado como `1.2 Reading Group Patterns.mp4`",
        );

        expect(parentMd).toContain(
          "[Sample Lesson](https://training.example/c/community/sample-lesson) — Baixado como `1.2 Sample Lesson Video.mp4`",
        );

        expect(parentMd).toContain(
          "[Pattern Notes](https://training.example/c/notes/pattern-notes) — Baixado como `1.2 Pattern Notes.md`",
        );

        expect(parentMd).toContain(
          "- Nota: `1.2 Sample Lesson Video.md` (baixado)",
        );
      } finally {
        await queuePage.close().catch(() => {});
      }
    } finally {
      await coursePage.close().catch(() => {});
    }
  } finally {
    await setupPage.close().catch(() => {});
    await server.close();
  }
});
