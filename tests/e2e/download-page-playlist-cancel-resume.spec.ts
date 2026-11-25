import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures.ts";
import { generateTinyTsSegment } from "./download-page-fixtures.ts";

test("should preserve changed dropdown settings across retries and resume the full playlist cadence after cancel", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const segmentBuffer = await generateTinyTsSegment(setupPage);
    const requestedSegments: string[] = [];

    const gate: { releasePaused: (() => void) | null; paused: boolean } = {
      releasePaused: null,
      paused: false,
    };

    const pausedSignal = new Promise<void>((resolve) => {
      gate.releasePaused = resolve;
    });

    await context.route(
      "https://resume-course.example.test/**",
      async (route) => {
        const url = route.request().url();

        if (url.endsWith("/video.m3u8")) {
          await route.fulfill({
            status: 200,
            contentType: "application/vnd.apple.mpegurl",
            body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.1,\nseg0.ts\n#EXT-X-ENDLIST\n",
          });

          return;
        }

        if (url.includes("/lesson-0/1080p/seg0.ts") && !gate.paused) {
          gate.paused = true;
          await pausedSignal;
          await route.abort("aborted").catch(() => {});

          return;
        }

        if (url.endsWith("/seg0.ts")) {
          requestedSegments.push(new URL(url).pathname);

          await route.fulfill({
            status: 200,
            contentType: "video/mp2t",
            body: segmentBuffer,
          });

          return;
        }

        if (url.endsWith("/pt.vtt")) {
          await route.fulfill({
            status: 200,
            contentType: "text/vtt",
            body: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLegenda.\n",
          });

          return;
        }

        await route.fulfill({ status: 404, body: "Not Found" });
      },
    );

    const courseId = "e2e-resume-cadence";

    await setupPage.evaluate(async (id) => {
      const mkLesson = (index: number, name: string) => ({
        itemIndex: index,
        title: name,
        url: `https://resume-course.example.test/lesson-${index}/1080p/video.m3u8`,
        sourceUrl: `https://training.example/c/resume/sections/1/lessons/${index + 1}`,
        folderPath: ["(Playlist) Resume"],
        qualityOptions: [
          {
            label: "1080p (1920×1080)",
            url: `https://resume-course.example.test/lesson-${index}/1080p/video.m3u8`,
          },
          {
            label: "720p (1280×720)",
            url: `https://resume-course.example.test/lesson-${index}/720p/video.m3u8`,
          },
        ],
        subtitles: [
          {
            url: `https://resume-course.example.test/lesson-${index}/pt.vtt`,
            language: "Portuguese",
            label: "Portuguese",
          },
        ],
      });

      await chrome.storage.session.set({
        [`playlist-download:${id}`]: {
          title: "Resume Course",
          outputFormat: "mp4",
          playlistQualityPreference: "best",
          subtitleDownloadPreference: "include",
          segmentConcurrency: 3,
          completedItemIndices: [],
          items: [
            mkLesson(0, "1.1 First"),
            mkLesson(1, "1.2 Second"),
            mkLesson(2, "1.3 Third"),
          ],
        },
      });
    }, courseId);

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=${courseId}`,
      );

      await expect(downloadPage.locator("#cancel")).toBeVisible({
        timeout: 15000,
      });

      await expect(downloadPage.locator("#message")).toHaveText(
        "Fetching source segments…",
        { timeout: 15000 },
      );

      await downloadPage.click("#cancel");
      gate.releasePaused?.();

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download cancelled",
        { timeout: 15000 },
      );

      await expect(downloadPage.locator("#download-label")).toHaveText(
        "Resume playlist",
      );

      await expect(downloadPage.locator("#download")).toBeEnabled();
      await expect(downloadPage.locator("#container")).toBeEnabled();
      await expect(downloadPage.locator("#concurrency")).toBeEnabled();
      await expect(downloadPage.locator("#quality")).toBeEnabled();

      requestedSegments.length = 0;

      await downloadPage.selectOption("#container", "mkv");
      await downloadPage.selectOption("#concurrency", "1");
      await downloadPage.selectOption("#quality", "1");

      await downloadPage.click("#download");

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 30000 },
      );

      await expect(downloadPage.locator("#container")).toHaveValue("mkv");
      await expect(downloadPage.locator("#concurrency")).toHaveValue("1");

      expect(requestedSegments).toEqual([
        "/lesson-0/720p/seg0.ts",
        "/lesson-1/720p/seg0.ts",
        "/lesson-2/720p/seg0.ts",
      ]);

      const storedCourse = await setupPage.evaluate(async (id) => {
        const data = await chrome.storage.session.get(
          `playlist-download:${id}`,
        );

        return data[`playlist-download:${id}`] as
          | {
              outputFormat?: string;
              segmentConcurrency?: number;
              playlistQualityPreference?: string;
              completedItemIndices?: number[];
            }
          | undefined;
      }, courseId);

      expect(storedCourse?.outputFormat).toBe("mkv");
      expect(storedCourse?.segmentConcurrency).toBe(1);
      expect(storedCourse?.playlistQualityPreference).toBe("720");
      expect(storedCourse?.completedItemIndices).toEqual([0, 1, 2]);

      const savedFiles = await readdir(
        join(downloadsDir, "HLS Videos", "(Playlist) Resume"),
      );

      expect(savedFiles).toContain("1.1 First.mkv");
      expect(savedFiles).toContain("1.2 Second.mkv");
      expect(savedFiles).toContain("1.3 Third.mkv");
    } finally {
      await downloadPage.close().catch(() => {});
    }
  } finally {
    await setupPage.close().catch(() => {});
    await context.unroute("https://resume-course.example.test/**");
  }
});
