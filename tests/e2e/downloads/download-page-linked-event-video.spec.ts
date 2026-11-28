import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../support/extension.ts";
import { generateTinyTsSegment } from "./support/download-actions.ts";
import { DIRECT_MP4_E2E_BYTES } from "./__fixtures__/download-data.ts";
import { startMaterialsE2eServer } from "./__mocks__/materials-server.ts";

test("should download a lesson with a primary HLS video, subtitle, and linked direct MP4 event video without FFmpeg remux", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  await setupPage.goto(`chrome-extension://${extensionId}/src/index.html`);
  const segmentBuffer = await generateTinyTsSegment(setupPage);
  const server = await startMaterialsE2eServer(segmentBuffer);
  const baseUrl = `http://materials.example.test:${server.port}`;

  try {
    const scanId = "e2e-direct-mp4-scan";
    const liveEventUrl = `${baseUrl}/c/community-events/session-alpha`;

    await setupPage.evaluate(
      async ({ eventUrl, id, origin }) => {
        await chrome.storage.session.set({
          [`track-scan:${id}`]: {
            id,
            title: "Sample Node Course",
            status: "ready",
            rateLimited: false,
            nextTopicIndex: 1,
            currentTopicIndex: null,
            sourceTabId: null,
            startedAt: Date.now(),
            items: [
              {
                id: "5001",
                url: `${origin}/c/sample-course/sections/1/lessons/5001`,
                fileTitle: "1.1 O que vai ser construido",
                folderPath: ["(Track) Sample Course", "1. Introducao"],
              },
            ],
            discovered: [
              {
                key: "primary-hls-5001",
                url: `${origin}/video/playlist.m3u8`,
                host: `materials.example.test:${new URL(origin).port}`,
                title: "1.1 O que vai ser construido",
                primaryVideoTitle: "1.1 O que vai ser construido",
                sourceUrl: `${origin}/c/sample-course/sections/1/lessons/5001`,
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
                    key: `${origin}/video/live-event.mp4`,
                    url: `${origin}/video/live-event.mp4`,
                    host: `materials.example.test:${new URL(origin).port}`,
                    title: "1.1 Sessao Exemplo",
                    sourceUrl: eventUrl,
                    kind: "direct",
                    qualityOptions: [
                      {
                        url: `${origin}/video/live-event.mp4`,
                        label: "Original MP4",
                      },
                    ],
                    subtitles: [],
                  },
                ],
                detectedAt: Date.now(),
                folderPath: ["(Track) Sample Course", "1. Introducao"],
                topicIndex: 0,
                documents: {
                  markdown: [
                    "# 1.1 O que vai ser construido",
                    "",
                    `[Session 1](${eventUrl})`,
                    "",
                  ].join("\n"),
                  images: [
                    {
                      kind: "image",
                      url: `${origin}/redirect-img`,
                      filename: "sistema.png",
                      contentType: "image/png",
                    },
                  ],
                  pdfs: [],
                  diagrams: [],
                  slides: [],
                  extraNotes: [
                    {
                      title: "Sessao Exemplo",
                      sourceUrl: eventUrl,
                      markdown: "# Sessao Exemplo\n\nResumo do sistema.\n",
                    },
                  ],
                },
              },
            ],
          },
        });
      },
      { eventUrl: liveEventUrl, id: scanId, origin: baseUrl },
    );

    const coursePage = await context.newPage();
    const cdp = await context.newCDPSession(setupPage);

    await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

    try {
      await coursePage.goto(
        `chrome-extension://${extensionId}/src/track.html?scan=${scanId}`,
      );

      await expect(coursePage.locator(".topic-meta").first()).toContainText(
        "2 videos · Portuguese · MD · 1 image",
      );

      const queuePagePromise = context.waitForEvent("page");

      await coursePage.click("#download-all");
      const queuePage = await queuePagePromise;

      try {
        await expect(queuePage.locator("#message")).toHaveText(
          "Track download finished",
          { timeout: 30000 },
        );

        expect(server.hitCount("direct-mp4")).toBe(1);

        const lessonFolder = join(
          downloadsDir,
          "HLS Videos",
          "(Track) Sample Course",
          "1. Introducao",
        );

        const files = await readdir(lessonFolder);

        expect(files).toContain("1.1 O que vai ser construido.mp4");
        expect(files).toContain("1.1 O que vai ser construido.vtt");
        expect(files).toContain("1.1 Sessao Exemplo.mp4");
        expect(files).toContain("1.1 Sessao Exemplo.md");
        expect(files).toContain("1.1 sistema.png");
        expect(files).toContain("1.1 O que vai ser construido.md");

        const directMp4 = await readFile(
          join(lessonFolder, "1.1 Sessao Exemplo.mp4"),
        );

        expect(directMp4.equals(DIRECT_MP4_E2E_BYTES)).toBe(true);

        const parentMd = await readFile(
          join(lessonFolder, "1.1 O que vai ser construido.md"),
          "utf8",
        );

        expect(parentMd).toContain(
          `[Session 1](${liveEventUrl}) — Baixado como \`1.1 Sessao Exemplo.mp4\``,
        );

        expect(parentMd).toContain("- Nota: `1.1 Sessao Exemplo.md` (baixado)");
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
