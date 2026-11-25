import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures.ts";
import { generateTinyTsSegment } from "./download-page-fixtures.ts";

test("should drive app.ts Download and FFmpeg remux to save both MP4 and VTT with the clean video name rather than a blob UUID", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);

    // Generate a real tiny valid H.264 MPEG-TS segment in-memory using the bundled FFmpeg core.
    const segmentBuffer = await generateTinyTsSegment(setupPage, true);

    await context.route("https://media.example.test/**", async (route) => {
      const url = route.request().url();

      if (url.includes("/lesson-429/")) {
        await route.fulfill({
          status: 429,
          contentType: "text/plain",
          body: "Too Many Requests",
        });

        return;
      }

      if (url.endsWith("/720p/video.m3u8")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.1,\nseg0.ts\n#EXT-X-ENDLIST\n",
        });

        return;
      }

      if (url.endsWith("/720p/seg0.ts")) {
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
          body: "WEBVTT\n\n00:00:00.080 --> 00:00:02.240\nOlá pessoal!\n",
        });

        return;
      }

      await route.fulfill({ status: 404, body: "Not Found" });
    });

    const requestId = "e2e-real-app-download";

    await setupPage.evaluate(async (id) => {
      await chrome.storage.session.set({
        [`download-request:${id}`]: {
          url: "https://media.example.test/video/720p/video.m3u8",
          selectedQualityUrl:
            "https://media.example.test/video/720p/video.m3u8",
          selectedLabel: "720p (1280×720)",
          title: "Introdução ao Curso de Exemplo",
          sourceUrl:
            "https://training.example/c/sample-course/sections/1/lessons/1",
          outputFormat: "mp4",
          autoStart: true,
          qualityOptions: [
            {
              url: "https://media.example.test/video/720p/video.m3u8",
              label: "720p (1280×720)",
            },
          ],
          subtitle: {
            url: "https://media.example.test/video/pt.vtt",
            language: "Portuguese",
            label: "Portuguese",
          },
        },
      });
    }, requestId);

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${requestId}`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "MP4 and subtitle finished",
        { timeout: 25000 },
      );

      const uuidPattern =
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

      const filesOnDisk = (
        await readdir(downloadsDir, { recursive: true })
      ).map((entry) => entry.replaceAll("\\", "/"));

      expect(filesOnDisk).toContain(
        "HLS Videos/Introdução ao Curso de Exemplo.mp4",
      );

      expect(filesOnDisk).toContain(
        "HLS Videos/Introdução ao Curso de Exemplo.vtt",
      );

      const videoBytes = await readFile(
        join(downloadsDir, "HLS Videos", "Introdução ao Curso de Exemplo.mp4"),
      );

      const videoInfo = await downloadPage.evaluate(
        async (bytes: number[]) => {
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
          );

          const video = document.createElement("video");

          try {
            video.src = url;

            await new Promise<void>((resolve, reject) => {
              video.onloadeddata = () => resolve();

              video.onerror = () =>
                reject(new Error("Downloaded MP4 cannot be decoded."));
            });

            return {
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration,
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        [...videoBytes],
      );

      expect(videoInfo.width).toBe(32);
      expect(videoInfo.height).toBe(32);
      expect(videoInfo.duration).toBeGreaterThan(0);
      expect(videoInfo.duration).toBeLessThan(2);

      const decodedTracks = await downloadPage.evaluate(
        async (bytes: number[]) => {
          const { FFmpeg } = (await import(
            chrome.runtime.getURL("vendor/ffmpeg/classes.js")
          )) as {
            FFmpeg: new () => {
              load(config: Record<string, string>): Promise<void>;
              writeFile(path: string, data: Uint8Array): Promise<void>;
              exec(args: string[]): Promise<number>;
              terminate(): void;
            };
          };

          const ffmpeg = new FFmpeg();

          try {
            await ffmpeg.load({
              classWorkerURL: chrome.runtime.getURL("vendor/ffmpeg/worker.js"),
              coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
              wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm"),
            });

            await ffmpeg.writeFile("download.mp4", new Uint8Array(bytes));

            const video = await ffmpeg.exec([
              "-i",
              "download.mp4",
              "-map",
              "0:v:0",
              "-f",
              "null",
              "-",
            ]);

            const audio = await ffmpeg.exec([
              "-i",
              "download.mp4",
              "-map",
              "0:a:0",
              "-f",
              "null",
              "-",
            ]);

            return { video, audio };
          } finally {
            ffmpeg.terminate();
          }
        },
        [...videoBytes],
      );

      expect(decodedTracks).toEqual({ video: 0, audio: 0 });

      for (const file of filesOnDisk) {
        expect(file).not.toMatch(uuidPattern);
      }

      // Now verify a multi-lesson course queue (`index.html?playlist=...`) downloads
      // Lesson 1 and Lesson 2 sequentially across distinct CDN directories and
      // survives a page reload without resetting to "Course download unavailable".
      const courseId = "e2e-course-queue";

      await setupPage.evaluate(async (id) => {
        await chrome.storage.session.set({
          [`playlist-download:${id}`]: {
            title: "IA First Dev",
            outputFormat: "mp4",
            playlistQualityPreference: "best",
            subtitleDownloadPreference: "included",
            segmentConcurrency: 3,
            completedItemIndices: [],
            items: [
              {
                itemIndex: 0,
                title: "1.1 Aula Um",
                url: "https://media.example.test/lesson-1/720p/video.m3u8",
                sourceUrl: "https://training.example/c/ai/sections/1/lessons/1",
                folderPath: ["1. IA First Dev"],
                qualityOptions: [
                  {
                    url: "https://media.example.test/lesson-1/720p/video.m3u8",
                    label: "720p (1280×720)",
                  },
                ],
                subtitles: [],
              },
              {
                itemIndex: 1,
                title: "1.2 Aula Dois",
                url: "https://media.example.test/lesson-2/720p/video.m3u8",
                sourceUrl: "https://training.example/c/ai/sections/1/lessons/2",
                folderPath: ["1. IA First Dev"],
                qualityOptions: [
                  {
                    url: "https://media.example.test/lesson-2/720p/video.m3u8",
                    label: "720p (1280×720)",
                  },
                ],
                subtitles: [],
              },
            ],
          },
        });
      }, courseId);

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=${courseId}`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 25000 },
      );

      await expect(downloadPage.locator("#playlist-download-note")).toHaveText(
        "2 items saved.",
      );

      const courseFilesOnDisk = (
        await readdir(downloadsDir, { recursive: true })
      ).map((entry) => entry.replaceAll("\\", "/"));

      expect(courseFilesOnDisk).toContain(
        "HLS Videos/1. IA First Dev/1.1 Aula Um.mp4",
      );

      expect(courseFilesOnDisk).toContain(
        "HLS Videos/1. IA First Dev/1.2 Aula Dois.mp4",
      );

      // Reloading the course download tab must retain the plan in session storage
      // rather than resetting to "Course download unavailable".
      await downloadPage.reload();

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 10000 },
      );

      // Verify systemic HTTP 429 during a course batch queue halts the queue immediately
      // without marking the failed lesson completed or hammering subsequent lessons.
      const rateLimitedCourseId = "e2e-course-rate-limited";

      await setupPage.evaluate(async (id) => {
        await chrome.storage.session.set({
          [`playlist-download:${id}`]: {
            title: "IA First Dev",
            outputFormat: "mp4",
            playlistQualityPreference: "best",
            subtitleDownloadPreference: "none",
            segmentConcurrency: 3,
            completedItemIndices: [],
            items: [
              {
                itemIndex: 0,
                title: "2.1 Aula Rate Limited",
                url: "https://media.example.test/lesson-429/720p/video.m3u8",
                sourceUrl: "https://training.example/c/ai/sections/2/lessons/1",
                folderPath: ["2. Rate Limit Test"],
                qualityOptions: [
                  {
                    url: "https://media.example.test/lesson-429/720p/video.m3u8",
                    label: "720p (1280×720)",
                  },
                ],
                subtitles: [],
              },
              {
                itemIndex: 1,
                title: "2.2 Aula Must Not Run",
                url: "https://media.example.test/lesson-skipped/720p/video.m3u8",
                sourceUrl: "https://training.example/c/ai/sections/2/lessons/2",
                folderPath: ["2. Rate Limit Test"],
                qualityOptions: [
                  {
                    url: "https://media.example.test/lesson-skipped/720p/video.m3u8",
                    label: "720p (1280×720)",
                  },
                ],
                subtitles: [],
              },
            ],
          },
        });
      }, rateLimitedCourseId);

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=${rateLimitedCourseId}`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download paused — rate limit reached",
        { timeout: 10000 },
      );

      const storedPlan = await setupPage.evaluate(async (id) => {
        const result = await chrome.storage.session.get(
          `playlist-download:${id}`,
        );

        return result[`playlist-download:${id}`] as
          { completedItemIndices?: readonly number[] } | undefined;
      }, rateLimitedCourseId);

      expect(storedPlan?.completedItemIndices ?? []).toEqual([]);
    } finally {
      await downloadPage.close();
    }
  } finally {
    await setupPage.close();
    await context.unroute("https://media.example.test/**");
  }
});
