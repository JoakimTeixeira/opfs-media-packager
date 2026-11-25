import { readdir, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";

async function generateTinyTsSegment(
  page: Page,
  withAudio = false,
): Promise<Buffer> {
  const segmentBase64 = await page.evaluate(async (includeAudio) => {
    const { FFmpeg } = (await import(
      chrome.runtime.getURL("vendor/ffmpeg/classes.js")
    )) as {
      FFmpeg: new () => {
        load(cfg: Record<string, string>): Promise<void>;
        exec(args: string[]): Promise<number>;
        readFile(path: string): Promise<Uint8Array>;
        terminate(): void;
      };
    };

    const ff = new FFmpeg();

    await ff.load({
      classWorkerURL: chrome.runtime.getURL("vendor/ffmpeg/worker.js"),
      coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm"),
    });

    const code = await ff.exec([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:d=0.1:r=10",
      ...(includeAudio
        ? [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.1",
            "-c:a",
            "aac",
            "-shortest",
          ]
        : []),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-f",
      "mpegts",
      "tiny.ts",
    ]);

    if (code !== 0) throw new Error(`FFmpeg fixture failed: ${code}`);
    const bytes = await ff.readFile("tiny.ts");

    ff.terminate();

    return btoa(String.fromCharCode(...bytes));
  }, withAudio);

  return Buffer.from(segmentBase64, "base64");
}

const downloadRequest = Object.freeze({
  autoStart: false,
  outputFormat: "mkv",
  qualityOptions: Object.freeze([
    Object.freeze({
      label: "720p",
      url: "https://media.example.net/asset/720p/video.m3u8",
    }),
    Object.freeze({
      label: "480p",
      url: "https://media.example.net/asset/480p/video.m3u8",
    }),
    Object.freeze({
      label: "360p",
      url: "https://media.example.net/asset/360p/video.m3u8",
    }),
    Object.freeze({
      label: "240p",
      url: "https://media.example.net/asset/240p/video.m3u8",
    }),
  ]),
  selectedLabel: "720p",
  selectedQualityUrl: "https://media.example.net/asset/720p/video.m3u8",
  sourceUrl: "https://training.example/courses/course/lesson/1",
  subtitle: null,
  title: "E2E lesson",
  url: "https://media.example.net/asset/720p/video.m3u8",
});

test("should keep every supplied quality selectable before and after a refresh", async ({
  extensionFixture,
}) => {
  const { context, extensionId, serviceWorker } = extensionFixture;

  await serviceWorker.evaluate(async (download) => {
    await chrome.storage.session.set({ "download-request:e2e": download });
  }, downloadRequest);

  const page = await context.newPage();

  try {
    await page.goto(
      `chrome-extension://${extensionId}/index.html?download-request=e2e`,
    );

    const quality = page.locator("#quality");

    await expect(quality).toBeEnabled();

    await expect(quality.locator("option")).toHaveText([
      "720p",
      "480p",
      "360p",
      "240p",
    ]);

    await expect(page.locator("#cancel")).toBeHidden();
    await expect(page.locator("#filename")).toBeEnabled();
    await expect(page.locator("#container")).toBeEnabled();
    await expect(page.locator("#concurrency")).toBeEnabled();
    await expect(page.locator("#download-subfolder")).toBeEnabled();
    await page.reload();
    await expect(quality).toBeEnabled();

    await expect(quality.locator("option")).toHaveText([
      "720p",
      "480p",
      "360p",
      "240p",
    ]);

    await expect(page.locator("#cancel")).toBeHidden();
    await expect(page.locator("#filename")).toBeEnabled();
    await expect(page.locator("#container")).toBeEnabled();
    await expect(page.locator("#concurrency")).toBeEnabled();
    await expect(page.locator("#download-subfolder")).toBeEnabled();
  } finally {
    await page.close();
  }
});

test("should load the FFmpeg worker from the vendor path used by the bundled page", async ({
  extensionFixture,
}) => {
  const { context, extensionId } = extensionFixture;
  const page = await context.newPage();

  try {
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await expect(
      page.evaluate(async () => {
        const workerUrl = chrome.runtime.getURL("vendor/ffmpeg/worker.js");
        const worker = new Worker(workerUrl, { type: "module" });

        return await new Promise<boolean>((done, fail) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            done(true);
          }, 250);

          worker.addEventListener("error", () => {
            clearTimeout(timeout);
            worker.terminate();
            fail(new Error("Vendor FFmpeg worker did not load."));
          });
        });
      }),
    ).resolves.toBe(true);
  } finally {
    await page.close();
  }
});

test("should start a popup handoff automatically before surfacing a playlist failure", async ({
  extensionFixture,
}) => {
  const { context, extensionId } = extensionFixture;

  await context.route("https://media.example.test/**", (route) =>
    route.fulfill({
      body: "Not authorized",
      contentType: "application/vnd.apple.mpegurl",
      status: 403,
    }),
  );

  const popup = await context.newPage();
  const opened: { page: Page | null } = { page: null };

  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const downloadPage = context.waitForEvent("page");

    await popup.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: "open-download",
        download: {
          autoStart: true,
          outputFormat: "mkv",
          qualityOptions: [
            {
              label: "720p",
              url: "https://media.example.test/asset/720p/video.m3u8",
            },
          ],
          selectedLabel: "720p",
          selectedQualityUrl:
            "https://media.example.test/asset/720p/video.m3u8",
          sourceUrl: "https://training.example/courses/course/lesson/1",
          subtitle: null,
          title: "E2E automatic handoff",
          url: "https://media.example.test/asset/720p/video.m3u8",
        },
      });
    });

    opened.page = await downloadPage;
    await opened.page.waitForLoadState();

    await expect(opened.page.locator("#message")).toHaveText(
      "Download could not start",
    );

    await expect(opened.page.locator("#details")).toContainText(
      "could not confirm access",
    );
  } finally {
    if (opened.page) await opened.page.close();
    await popup.close();
    await context.unroute("https://media.example.test/**");
  }
});

test("should keep a dense course popup clear, deduplicated, and operable", async ({
  extensionFixture,
}) => {
  const { context, extensionId } = extensionFixture;
  const popup = await context.newPage();

  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const tabId = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      return tab?.id;
    });

    const mediaAsset = "22222222-2222-4222-8222-222222222222";

    await popup.evaluate(
      async ({ assetId, tabId: currentTabId }) => {
        const qualityOptions = [
          { label: "1080p (1920×1080)", url: "https://media.test/1080.m3u8" },
          { label: "720p (1280×720)", url: "https://media.test/720.m3u8" },
          { label: "480p (854×480)", url: "https://media.test/480.m3u8" },
          { label: "Auto", url: "https://media.test/auto.m3u8" },
        ];

        await chrome.storage.session.set({
          [`playlist-outline:${currentTabId}`]: {
            title: "Sample Track Dev",
            items: [
              {
                fileTitle: "1.1 Fundamentals",
                folderPath: ["1. Sample Track Dev", "1. Fundamentals"],
                id: "lesson-1",
                url: "https://training.example/c/sample-course/sections/one/lessons/one",
              },
              {
                fileTitle: "1.2 Prompts",
                folderPath: ["1. Sample Track Dev", "1. Fundamentals"],
                id: "lesson-2",
                url: "https://training.example/c/sample-course/sections/one/lessons/two",
              },
            ],
          },
          [`detections:${currentTabId}`]: {
            streams: [
              {
                host: "signed-media.example",
                key: "old-token-one",
                sourceUrl: "https://training.example/c/sample-course",
                subtitles: [
                  { language: "Portuguese", url: "https://media.test/pt.vtt" },
                ],
                title: "A focused lesson title that should truncate cleanly",
                url: `https://signed-media.example/token=one/${assetId}/hls/playlist.m3u8`,
                qualityOptions,
              },
              {
                host: "signed-media.example",
                key: "old-token-two",
                sourceUrl: "https://training.example/c/sample-course",
                subtitles: [],
                title: "A focused lesson title that should truncate cleanly",
                url: `https://signed-media.example/token=two/${assetId}/hls/720p/playlist.m3u8`,
                qualityOptions: [qualityOptions[1]],
              },
            ],
            subtitles: [],
          },
        });
      },
      { assetId: mediaAsset, tabId },
    );

    await popup.reload();

    await expect(popup.locator("article.playlist")).toContainText(
      "Sample Track Dev",
    );

    await expect(popup.locator(".playlist-copy")).toHaveText(
      "2 items ready to scan",
    );

    await expect(popup.locator("article.item")).toHaveCount(1);

    await expect(
      popup.locator('select[aria-label="Video quality"] option'),
    ).toHaveText(["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"]);

    await expect(
      popup.locator('select[aria-label="Subtitle language"]'),
    ).toHaveValue("https://media.test/pt.vtt");

    await expect(popup.locator("footer")).toHaveCount(0);
    await expect(popup.locator(".download-setup")).toHaveCount(0);

    await expect(
      popup
        .locator("body")
        .evaluate((body) => body.scrollWidth <= body.clientWidth),
    ).resolves.toBe(true);

    await expect(popup.locator(".download")).toBeEnabled();

    await expect(popup.locator(".icon-button")).toHaveAttribute(
      "aria-label",
      "Copy M3U8 URL",
    );

    const scanPagePromise = context.waitForEvent("page");

    await popup.locator(".scan").click();
    const scanPage = await scanPagePromise;

    await expect(scanPage).toHaveURL(/playlist\.html\?scan=/);
    await scanPage.close();
  } finally {
    await popup.close().catch(() => {});
  }
});

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

test("should save an MKV containing decodable audio, video, and a default subtitle", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const segment = await generateTinyTsSegment(setupPage, true);

    await context.route("https://mkv.example.test/**", async (route) => {
      const url = route.request().url();

      if (url.endsWith("video.m3u8")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.1,\nseg.ts\n#EXT-X-ENDLIST\n",
        });

        return;
      }

      if (url.endsWith("seg.ts")) {
        await route.fulfill({
          status: 200,
          contentType: "video/mp2t",
          body: segment,
        });

        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "text/vtt",
        body: "WEBVTT\n\n00:00:00.000 --> 00:00:00.100\nHello there\n",
      });
    });

    const requestId = "e2e-mkv-default-subtitle";

    await setupPage.evaluate(async (id) => {
      const url = "https://mkv.example.test/video.m3u8";

      await chrome.storage.session.set({
        [`download-request:${id}`]: {
          url,
          selectedQualityUrl: url,
          selectedLabel: "720p",
          title: "Media fixture",
          sourceUrl: "https://training.example/lesson/1",
          outputFormat: "mkv",
          autoStart: true,
          qualityOptions: [{ url, label: "720p" }],
          subtitle: {
            url: "https://mkv.example.test/subtitle.vtt",
            language: "English",
            label: "English",
          },
        },
      });
    }, requestId);

    const page = await context.newPage();

    try {
      const cdp = await context.newCDPSession(page);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await page.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${requestId}`,
      );

      await expect(page.locator("#message")).toHaveText(
        "MKV download finished",
        { timeout: 25000 },
      );

      const filePath = join(downloadsDir, "HLS Videos", "Media fixture.mkv");

      await expect(async () =>
        expect((await readFile(filePath)).length).toBeGreaterThan(0),
      ).toPass({ timeout: 15000 });

      const bytes = await readFile(filePath);

      const result = await page.evaluate(
        async (data: number[]) => {
          const { FFmpeg } = (await import(
            chrome.runtime.getURL("vendor/ffmpeg/classes.js")
          )) as {
            FFmpeg: new () => {
              load(config: Record<string, string>): Promise<void>;
              writeFile(path: string, data: Uint8Array): Promise<void>;
              readFile(path: string): Promise<Uint8Array>;
              exec(args: string[]): Promise<number>;
              on(
                event: string,
                callback: (event: { message: string }) => void,
              ): void;
              terminate(): void;
            };
          };

          const ff = new FFmpeg();
          const messages: string[] = [];

          ff.on("log", ({ message }) => messages.push(message));

          try {
            await ff.load({
              classWorkerURL: chrome.runtime.getURL("vendor/ffmpeg/worker.js"),
              coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
              wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm"),
            });

            await ff.writeFile("input.mkv", new Uint8Array(data));

            const video = await ff.exec([
              "-i",
              "input.mkv",
              "-map",
              "0:v:0",
              "-f",
              "null",
              "-",
            ]);

            const audio = await ff.exec([
              "-i",
              "input.mkv",
              "-map",
              "0:a:0",
              "-f",
              "null",
              "-",
            ]);

            const subtitle = await ff.exec([
              "-i",
              "input.mkv",
              "-map",
              "0:s:0",
              "subtitle.vtt",
            ]);

            const text = new TextDecoder().decode(
              await ff.readFile("subtitle.vtt"),
            );

            return {
              video,
              audio,
              subtitle,
              text,
              defaultSubtitle: messages.some((message) =>
                /Subtitle:.*\(default\)/.test(message),
              ),
            };
          } finally {
            ff.terminate();
          }
        },
        [...bytes],
      );

      expect(result.video).toBe(0);
      expect(result.audio).toBe(0);
      expect(result.subtitle).toBe(0);
      expect(result.text).toContain("Hello there");
      expect(result.defaultSubtitle).toBe(true);
    } finally {
      await page.close();
    }
  } finally {
    await setupPage.close();
  }
});

test("should stop a course after two denied lessons without requesting the third", async ({
  extensionFixture,
}) => {
  const { context, extensionId } = extensionFixture;
  const setupPage = await context.newPage();
  const requests: string[] = [];

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);

    await context.route("https://denied.example.test/**", async (route) => {
      requests.push(route.request().url());

      await route.fulfill({
        status: 403,
        contentType: "text/plain",
        body: "Forbidden",
      });
    });

    const courseId = "e2e-course-denied";

    await setupPage.evaluate(async (id) => {
      const items = [0, 1, 2].map((index) => {
        const url = `https://denied.example.test/lesson-${index}/video.m3u8`;

        return {
          itemIndex: index,
          title: `Lesson ${index + 1}`,
          url,
          sourceUrl: `https://training.example/lesson/${index}`,
          folderPath: ["Playlist"],
          qualityOptions: [{ url, label: "720p" }],
          subtitles: [],
        };
      });

      await chrome.storage.session.set({
        [`playlist-download:${id}`]: {
          title: "Playlist",
          outputFormat: "mp4",
          playlistQualityPreference: "best",
          subtitleDownloadPreference: "none",
          segmentConcurrency: 1,
          completedItemIndices: [],
          items,
        },
      });
    }, courseId);

    const page = await context.newPage();

    try {
      await page.goto(
        `chrome-extension://${extensionId}/index.html?playlist=${courseId}`,
      );

      await expect(page.locator("#message")).toHaveText(
        "Playlist download paused: access denied",
        { timeout: 30000 },
      );

      const completed = await setupPage.evaluate(async (id) => {
        const entry = await chrome.storage.session.get(
          `playlist-download:${id}`,
        );

        const plan = entry[`playlist-download:${id}`] as {
          completedItemIndices: number[];
        };

        return plan.completedItemIndices;
      }, courseId);

      expect(completed).toEqual([]);
      expect(requests.some((url) => url.includes("lesson-0"))).toBe(true);
      expect(requests.some((url) => url.includes("lesson-1"))).toBe(true);
      expect(requests.some((url) => url.includes("lesson-2"))).toBe(false);
    } finally {
      await page.close();
    }
  } finally {
    await setupPage.close();
  }
});

test("should stream segments through OPFS with discontinuity splitting, sweep stale temp dirs, and fall back to MEMFS when OPFS is unavailable", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const segmentBuffer = await generateTinyTsSegment(setupPage);

    // Pre-seed one stale remux workspace directory and one unrelated directory in OPFS.
    await setupPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();

      await root.getDirectoryHandle("hls-remux-stale-crash", { create: true });
      await root.getDirectoryHandle("unrelated-keep", { create: true });
    });

    await context.route("https://large.example.test/**", async (route) => {
      const url = route.request().url();

      if (url.endsWith("/1080p/video.m3u8")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            "#EXT-X-TARGETDURATION:1",
            "#EXTINF:0.1,",
            "seg0.ts",
            "#EXTINF:0.1,",
            "seg1.ts",
            "#EXT-X-DISCONTINUITY",
            "#EXTINF:0.1,",
            "seg2.ts",
            "#EXT-X-ENDLIST",
          ].join("\n"),
        });

        return;
      }

      if (/\/seg\d+\.ts$/.test(url)) {
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
          body: "WEBVTT\n\n00:00:00.050 --> 00:00:00.250\nLegenda de teste.\n",
        });

        return;
      }

      await route.fulfill({ status: 404, body: "Not Found" });
    });

    const opfsReqId = "e2e-opfs-discontinuity";

    await setupPage.evaluate(async (id) => {
      await chrome.storage.session.set({
        [`download-request:${id}`]: {
          url: "https://large.example.test/lesson/1080p/video.m3u8",
          selectedQualityUrl:
            "https://large.example.test/lesson/1080p/video.m3u8",
          selectedLabel: "1080p",
          title: "Workshop Completo OPFS",
          sourceUrl: "https://training.example/c/workshop/sections/1/lessons/1",
          outputFormat: "mp4",
          autoStart: true,
          qualityOptions: [
            {
              url: "https://large.example.test/lesson/1080p/video.m3u8",
              label: "1080p",
            },
          ],
          subtitle: {
            url: "https://large.example.test/lesson/pt.vtt",
            language: "Portuguese",
            label: "Portuguese",
          },
        },
      });
    }, opfsReqId);

    const opfsPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(opfsPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await opfsPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${opfsReqId}`,
      );

      await expect(opfsPage.locator("#message")).toHaveText(
        "MP4 and subtitle finished",
        { timeout: 25000 },
      );

      const postState = await opfsPage.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const entries: string[] = [];

        for await (const key of root.keys()) entries.push(key);

        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        return { entries, autoDiscardable: tab?.autoDiscardable };
      });

      expect(postState.entries).toContain("unrelated-keep");

      expect(
        postState.entries.filter((name) => name.startsWith("hls-remux-")),
      ).toEqual([]);

      expect(postState.autoDiscardable).toBe(true);

      const mp4Bytes = await readFile(
        join(downloadsDir, "HLS Videos", "Workshop Completo OPFS.mp4"),
      );

      const firstBoxSize = mp4Bytes.readUInt32BE(0);
      const firstBoxType = mp4Bytes.subarray(4, 8).toString("ascii");

      const secondBoxType = mp4Bytes
        .subarray(firstBoxSize + 4, firstBoxSize + 8)
        .toString("ascii");

      expect(firstBoxType).toBe("ftyp");
      expect(secondBoxType).toBe("moov");
    } finally {
      await opfsPage.close();
    }

    // Verify graceful MEMFS fallback when OPFS is unavailable.
    const fallbackReqId = "e2e-memfs-fallback";

    await setupPage.evaluate(async (id) => {
      await chrome.storage.session.set({
        [`download-request:${id}`]: {
          url: "https://large.example.test/lesson/1080p/video.m3u8",
          selectedQualityUrl:
            "https://large.example.test/lesson/1080p/video.m3u8",
          selectedLabel: "1080p",
          title: "Workshop Fallback MEMFS",
          sourceUrl: "https://training.example/c/workshop/sections/1/lessons/1",
          outputFormat: "mp4",
          autoStart: true,
          qualityOptions: [
            {
              url: "https://large.example.test/lesson/1080p/video.m3u8",
              label: "1080p",
            },
          ],
          subtitle: {
            url: "https://large.example.test/lesson/pt.vtt",
            language: "Portuguese",
            label: "Portuguese",
          },
        },
      });
    }, fallbackReqId);

    const fallbackPage = await context.newPage();

    try {
      await fallbackPage.addInitScript(() => {
        Object.defineProperty(navigator.storage, "getDirectory", {
          configurable: true,
          value: () =>
            Promise.reject(
              new DOMException("OPFS disabled for test", "SecurityError"),
            ),
        });
      });

      const cdp = await context.newCDPSession(fallbackPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await fallbackPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${fallbackReqId}`,
      );

      await expect(fallbackPage.locator("#message")).toHaveText(
        "MP4 and subtitle finished",
        { timeout: 25000 },
      );

      const fallbackBytes = await readFile(
        join(downloadsDir, "HLS Videos", "Workshop Fallback MEMFS.mp4"),
      );

      expect(fallbackBytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
    } finally {
      await fallbackPage.close();
    }
  } finally {
    await setupPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();

      await root
        .removeEntry("unrelated-keep", { recursive: true })
        .catch(() => {});
    });

    await setupPage.close();
    await context.unroute("https://large.example.test/**");
  }
});

const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

const SAMPLE_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "ascii",
);

function buildDoubleEncodedPortugueseVtt(): Buffer {
  const cleanText =
    "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:04.000\r\nVamos começar a 1º aula! É então possível.\r\n";

  const cleanBytes = Buffer.from(cleanText, "utf8");

  // Simulate Windows-1252 interpretation of UTF-8 bytes re-saved as UTF-8.
  const mojibake = Array.from(cleanBytes, (byte) =>
    String.fromCharCode(byte),
  ).join("");

  return Buffer.from(mojibake, "utf8");
}

async function runMaterialsOnlyCourseFromCoursePage(
  context: Page["context"] extends () => infer C ? C : never,
  extensionId: string,
  scanId: string,
): Promise<readonly string[]> {
  const coursePage = await context.newPage();
  const openedUrls: string[] = [];

  const recordOpenedPage = (page: Page): void => {
    openedUrls.push(page.url());

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) openedUrls.push(frame.url());
    });
  };

  context.on("page", recordOpenedPage);

  try {
    await coursePage.goto(
      `chrome-extension://${extensionId}/playlist.html?scan=${scanId}`,
    );

    await expect(coursePage.locator("#playlist-download-mode")).toHaveValue(
      "all",
    );

    await expect(coursePage.locator("#selection-count")).toHaveText(
      "2 of 2 items selected",
    );

    await expect(coursePage.locator("#download-all")).toBeEnabled();

    await expect(coursePage.locator("#download-all")).toHaveText(
      "Download all 2 items",
    );

    await expect(coursePage.locator(".item-select").first()).toBeChecked();

    await coursePage.selectOption("#playlist-download-mode", "documents");
    await expect(coursePage.locator("#format")).toBeDisabled();
    await expect(coursePage.locator("#download-all")).toBeEnabled();

    await coursePage.selectOption("#playlist-download-mode", "all");
    await expect(coursePage.locator("#format")).toBeEnabled();
    await expect(coursePage.locator("#download-all")).toBeEnabled();

    await expect(coursePage.locator(".item-meta").first()).toContainText(
      "MD · 1 PDF · 1 image · 1 diagram · 1 slides",
    );

    const queuePagePromise = context.waitForEvent("page");

    await coursePage.click("#download-all");
    const queuePage = await queuePagePromise;

    try {
      await expect(queuePage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 30000 },
      );

      expect(
        await queuePage
          .locator(
            'iframe[name^="opfs-media-packager-diagram-frame:"], iframe[name^="opfs-media-packager-slides-frame:"]',
          )
          .count(),
      ).toBe(0);

      return openedUrls;
    } finally {
      await queuePage.close().catch(() => {});
    }
  } finally {
    context.off("page", recordOpenedPage);
    await coursePage.close().catch(() => {});
  }
}

const E2E_SLIDES_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; width: 100%; height: 100%; background: #080c16; color: #f8fafc; font-family: sans-serif; }
  .slide { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; font-size: 64px; }
  .slide.active { display: flex; }
</style></head><body>
  <div class="slide active">Slide 1</div>
  <div class="slide">Slide 2</div>
  <div class="slide">Slide 3</div>
  <button id="next" type="button">Next</button>
  <script>
    let current = 0;
    const slides = [...document.querySelectorAll('.slide')];
    document.getElementById('next').addEventListener('click', () => {
      slides[current].classList.remove('active');
      current = Math.min(current + 1, slides.length - 1);
      slides[current].classList.add('active');
    });
  </script>
</body></html>`;

const E2E_EXCALIDRAW_HTML = `<!doctype html><html><body>
  <form id="guest-form"><button type="submit">Join as a guest</button></form>
  <button type="button" data-testid="main-menu-trigger" hidden>Menu</button>
  <button type="button" data-testid="image-export-button" hidden>Export image...</button>
  <div class="ImageExportModal" hidden>
    <label><input type="radio" name="exportScale" value="2" checked /> 2\u00d7</label>
    <label><input type="radio" name="exportScale" value="1" /> 1\u00d7</label>
    <button type="button" aria-label="Export to SVG">SVG</button>
  </div>
  <script>
    document.getElementById('guest-form').addEventListener('submit', (e) => {
      e.preventDefault();
      e.target.hidden = true;
      document.querySelector('[data-testid="main-menu-trigger"]').hidden = false;
    });
    document.querySelector('[data-testid="main-menu-trigger"]').addEventListener('click', () => {
      document.querySelector('[data-testid="image-export-button"]').hidden = false;
    });
    document.querySelector('[data-testid="image-export-button"]').addEventListener('click', () => {
      document.querySelector('.ImageExportModal').hidden = false;
    });
    document.querySelector('button[aria-label="Export to SVG"]').addEventListener('click', () => {
      const scale = document.querySelector('input[name="exportScale"]:checked')?.value || '2';
      const svgText = '<svg xmlns="http://www.w3.org/2000/svg" data-scale="' + scale + '"><rect width="10" height="10"/></svg>';
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'diagram.svg';
      a.click();
    });
  </script>
</body></html>`;

const DIRECT_MP4_E2E_BYTES = Buffer.from("ftypmp42-e2e-direct-video-stream");

function handleMaterialsE2eRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  segmentBuffer: Buffer,
  recordHit: (key: string) => void,
): void {
  const origin = req.headers.origin;

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();

    return;
  }

  const host = req.headers.host || "";

  const pathname = new URL(req.url || "/", `http://${host || "127.0.0.1"}`)
    .pathname;

  if (host.startsWith("e2e.excalidraw.com")) {
    if (pathname === "/s/test-room/scene-1") recordHit("diagram");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(E2E_EXCALIDRAW_HTML);

    return;
  }

  if (pathname === "/redirect-pdf") {
    recordHit("redirect-pdf");

    res.writeHead(302, {
      Location: `http://materials.example.test:${port}/files/apostila.pdf`,
    });

    res.end();

    return;
  }

  if (pathname === "/redirect-img") {
    recordHit("redirect-img");

    res.writeHead(302, {
      Location: `http://materials.example.test:${port}/files/diagrama.png`,
    });

    res.end();

    return;
  }

  const staticRoutes = new Map<
    string,
    {
      readonly contentType: string;
      readonly body: string | Buffer;
      readonly hitKey?: string;
    }
  >([
    [
      "/video/playlist.m3u8",
      {
        contentType: "application/vnd.apple.mpegurl",
        body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.1,\nseg0.ts\n#EXT-X-ENDLIST\n",
      },
    ],
    [
      "/video/seg0.ts",
      { contentType: "video/mp2t", body: segmentBuffer, hitKey: "seg0" },
    ],
    [
      "/video/live-event.mp4",
      {
        contentType: "video/mp4",
        body: DIRECT_MP4_E2E_BYTES,
        hitKey: "direct-mp4",
      },
    ],
    [
      "/video/mojibake.vtt",
      // Server omits `; charset=utf-8` AND serves double-encoded UTF-8 bytes.
      {
        contentType: "text/vtt",
        body: buildDoubleEncodedPortugueseVtt(),
        hitKey: "vtt",
      },
    ],
    [
      "/files/apostila.pdf",
      {
        contentType: "application/pdf",
        body: SAMPLE_PDF_BYTES,
        hitKey: "pdf",
      },
    ],
    [
      "/files/diagrama.png",
      { contentType: "image/png", body: TINY_PNG_BYTES, hitKey: "image" },
    ],
    [
      "/slides",
      {
        contentType: "text/html; charset=utf-8",
        body: E2E_SLIDES_HTML,
        hitKey: "slides",
      },
    ],
  ]);

  const matched = staticRoutes.get(pathname);

  if (matched) {
    if (matched.hitKey) recordHit(matched.hitKey);
    res.writeHead(200, { "Content-Type": matched.contentType });
    res.end(matched.body);

    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

async function startMaterialsE2eServer(segmentBuffer: Buffer): Promise<{
  readonly port: number;
  readonly hitCount: (key: string) => number;
  readonly close: () => Promise<void>;
}> {
  const portRef = { value: 0 };
  const hits = new Map<string, number>();

  const recordHit = (key: string): void => {
    hits.set(key, (hits.get(key) ?? 0) + 1);
  };

  const server: Server = createServer((req, res) => {
    handleMaterialsE2eRequest(
      req,
      res,
      portRef.value,
      segmentBuffer,
      recordHit,
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  portRef.value = address.port;

  return {
    port: address.port,
    hitCount: (key: string) => hits.get(key) ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });

        server.closeAllConnections();
      }),
  };
}

test("should repair double-encoded Portuguese VTT subtitles (preserving CRLF) and support Materials-only course downloads with sanitized annotated Markdown, deduplicated URLs, headless Excalidraw 1x SVG, and 3-slide PDF", async ({
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
    // 1. Verify double-encoded Portuguese VTT repair through the real app.ts download pipeline.
    const vttReqId = "e2e-vtt-encoding";

    await setupPage.evaluate(
      async ({ id, origin }) => {
        await chrome.storage.session.set({
          [`download-request:${id}`]: {
            url: `${origin}/video/playlist.m3u8`,
            selectedQualityUrl: `${origin}/video/playlist.m3u8`,
            selectedLabel: "720p (1280×720)",
            title: "2.4 Contexto e Português",
            sourceUrl:
              "https://training.example/c/workshop/sections/2/lessons/4",
            outputFormat: "mp4",
            autoStart: true,
            qualityOptions: [
              {
                url: `${origin}/video/playlist.m3u8`,
                label: "720p (1280×720)",
              },
            ],
            subtitle: {
              url: `${origin}/video/mojibake.vtt`,
              language: "Portuguese",
              label: "Portuguese",
            },
          },
        });
      },
      { id: vttReqId, origin: baseUrl },
    );

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${vttReqId}`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "MP4 and subtitle finished",
        { timeout: 25000 },
      );

      const repairedVtt = await readFile(
        join(downloadsDir, "HLS Videos", "2.4 Contexto e Português.vtt"),
        "utf8",
      );

      expect(repairedVtt).toContain(
        "Vamos começar a 1º aula! É então possível.",
      );

      expect(repairedVtt).not.toContain("Ã§");
      expect(repairedVtt).toContain("\r\n");

      // 2. Verify playlist.html default "all" -> "documents" mode, headless Excalidraw, URL dedup, and annotated Markdown across 2 lessons.
      const scanId = "e2e-materials-scan";

      await setupPage.evaluate(
        async ({ diagramUrl, id, origin }) => {
          await chrome.storage.session.set({
            [`playlist-scan:${id}`]: {
              id,
              title: "Workshop Materials",
              status: "ready",
              rateLimited: false,
              nextItemIndex: 2,
              currentItemIndex: null,
              sourceTabId: null,
              startedAt: Date.now(),
              items: [
                {
                  id: "101",
                  url: "https://training.example/c/workshop/sections/1/lessons/101",
                  fileTitle: "1.1 Arquitetura Completa",
                  folderPath: ["1. Dia 1"],
                },
                {
                  id: "102",
                  url: "https://training.example/c/workshop/sections/2/lessons/102",
                  fileTitle: "1.2 Revisao e Links",
                  folderPath: ["2. Dia 2"],
                },
              ],
              discovered: [
                {
                  key: "documents:0",
                  url: "",
                  host: "",
                  title: "1.1 Arquitetura Completa",
                  sourceUrl:
                    "https://training.example/c/workshop/sections/1/lessons/101",
                  kind: "media",
                  qualityOptions: [],
                  subtitles: [],
                  detectedAt: Date.now(),
                  folderPath: ["1. Dia 1"],
                  itemIndex: 0,
                  documents: {
                    markdown: [
                      "# 1.1 Arquitetura Completa",
                      "",
                      "•\uFE0F\uFFFC [https://tool-one.example/](https://tool-one.example/)",
                      "•\u200B [https://tool-two.example/](https://tool-two.example/)",
                      "",
                      "## **Slides**",
                      "",
                      `[Slides do case](${origin}/slides?slide=9)`,
                      "",
                      `[Diagrama](${diagramUrl})`,
                      "",
                      `[Guia PDF](${origin}/redirect-pdf)`,
                      "",
                      "## Conteúdos relacionados na comunidade",
                      "",
                      "- [Post relacionado](https://training.example/c/workshop/sections/1/lessons/999)",
                      "",
                    ].join("\n"),
                    pdfs: [
                      {
                        kind: "pdf",
                        url: `${origin}/redirect-pdf`,
                        filename: "Apostila do Modulo.pdf",
                        contentType: "application/pdf",
                      },
                    ],
                    images: [
                      {
                        kind: "image",
                        url: `${origin}/redirect-img`,
                        filename: "Fluxo Geral.png",
                        contentType: "image/png",
                      },
                    ],
                    diagrams: [
                      {
                        kind: "diagram",
                        url: diagramUrl,
                        title: "Diagrama Teste",
                      },
                    ],
                    slides: [
                      {
                        kind: "slides",
                        url: `${origin}/slides?slide=9`,
                        title: "Slides Teste",
                      },
                    ],
                  },
                },
                {
                  key: "documents:1",
                  url: "",
                  host: "",
                  title: "1.2 Revisao e Links",
                  sourceUrl:
                    "https://training.example/c/workshop/sections/2/lessons/102",
                  kind: "media",
                  qualityOptions: [],
                  subtitles: [],
                  detectedAt: Date.now(),
                  folderPath: ["2. Dia 2"],
                  itemIndex: 1,
                  documents: {
                    markdown: [
                      "# 1.2 Revisao e Links",
                      "",
                      "## **Slides**",
                      "",
                      `[Slides do case](${origin}/slides?slide=2)`,
                      "",
                      `[Diagrama](${diagramUrl})`,
                      "",
                    ].join("\n"),
                    pdfs: [
                      {
                        kind: "pdf",
                        url: `${origin}/redirect-pdf`,
                        filename: "Apostila do Modulo.pdf",
                        contentType: "application/pdf",
                      },
                    ],
                    images: [
                      {
                        kind: "image",
                        url: `${origin}/redirect-img`,
                        filename: "Fluxo Geral.png",
                        contentType: "image/png",
                      },
                    ],
                    diagrams: [
                      {
                        kind: "diagram",
                        url: diagramUrl,
                        title: "Diagrama Teste",
                      },
                    ],
                    slides: [
                      {
                        kind: "slides",
                        url: `${origin}/slides?slide=2`,
                        title: "Slides Teste",
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

      const openedUrls = await runMaterialsOnlyCourseFromCoursePage(
        context,
        extensionId,
        scanId,
      );

      expect(
        openedUrls.some(
          (url) => url.includes("excalidraw") || url.includes("/slides"),
        ),
      ).toBe(false);

      expect(server.hitCount("diagram")).toBe(1);
      expect(server.hitCount("redirect-pdf")).toBe(1);
      expect(server.hitCount("pdf")).toBe(1);
      expect(server.hitCount("redirect-img")).toBe(1);
      expect(server.hitCount("image")).toBe(1);
      expect(server.hitCount("slides")).toBe(1);

      const folder1 = join(downloadsDir, "HLS Videos", "1. Dia 1");
      const folder2 = join(downloadsDir, "HLS Videos", "2. Dia 2");

      const md1 = await readFile(
        join(folder1, "1.1 Arquitetura Completa.md"),
        "utf8",
      );

      expect(md1).toContain(
        "- [https://tool-one.example/](https://tool-one.example/)",
      );

      expect(md1).toContain(
        "- [https://tool-two.example/](https://tool-two.example/)",
      );

      expect(md1).not.toMatch(/[\uFE0F\u200B\uFFFC\uFFFD]/);
      expect(md1).not.toContain("Conteúdos relacionados");
      expect(md1).not.toContain("Post relacionado");
      expect(md1).toContain("— Baixado como `1.1 Slides Teste.pdf`");
      expect(md1).toContain("— Baixado como `1.1 Diagrama Teste.svg`");
      expect(md1).toContain("— Baixado como `1.1 Apostila do Modulo.pdf`");
      expect(md1).toContain("- Imagem: `1.1 Fluxo Geral.png` (baixado)");

      const pdfBytes = await readFile(
        join(folder1, "1.1 Apostila do Modulo.pdf"),
      );

      expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      const pngBytes = await readFile(join(folder1, "1.1 Fluxo Geral.png"));

      expect(pngBytes.equals(TINY_PNG_BYTES)).toBe(true);

      const svgText = await readFile(
        join(folder1, "1.1 Diagrama Teste.svg"),
        "utf8",
      );

      expect(svgText).toContain('data-scale="1"');
      expect(svgText).toContain("<svg");

      const slidesPdf = await readFile(join(folder1, "1.1 Slides Teste.pdf"));
      const slidesPdfText = slidesPdf.toString("latin1");

      expect(slidesPdfText.startsWith("%PDF-1.4")).toBe(true);
      expect(slidesPdfText).toContain("/Count 3");
      expect(slidesPdfText).toContain("%%EOF");

      const folder1Files = await readdir(folder1);

      expect(folder1Files.some((name) => name.endsWith(".mp4"))).toBe(false);

      const folder2Files = await readdir(folder2);

      expect(folder2Files).toEqual(["1.2 Revisao e Links.md"]);

      const md2 = await readFile(
        join(folder2, "1.2 Revisao e Links.md"),
        "utf8",
      );

      expect(md2).toContain(
        "— Já baixado como `1. Dia 1 / 1.1 Slides Teste.pdf`",
      );

      expect(md2).toContain(
        "— Já baixado como `1. Dia 1 / 1.1 Diagrama Teste.svg`",
      );

      expect(md2).toContain(
        "- PDF: `1. Dia 1 / 1.1 Apostila do Modulo.pdf` (já baixado)",
      );

      expect(md2).toContain(
        "- Imagem: `1. Dia 1 / 1.1 Fluxo Geral.png` (já baixado)",
      );
    } finally {
      await downloadPage.close();
    }
  } finally {
    await setupPage.close().catch(() => {});
    await server.close();
  }
});

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

test("should download a lesson with a primary HLS video, subtitle, and linked direct MP4 event video without FFmpeg remux", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
  const segmentBuffer = await generateTinyTsSegment(setupPage);
  const server = await startMaterialsE2eServer(segmentBuffer);
  const baseUrl = `http://materials.example.test:${server.port}`;

  try {
    const scanId = "e2e-direct-mp4-scan";
    const liveEventUrl = `${baseUrl}/c/community-events/session-alpha`;

    await setupPage.evaluate(
      async ({ eventUrl, id, origin }) => {
        await chrome.storage.session.set({
          [`playlist-scan:${id}`]: {
            id,
            title: "Sample Node Course",
            status: "ready",
            rateLimited: false,
            nextItemIndex: 1,
            currentItemIndex: null,
            sourceTabId: null,
            startedAt: Date.now(),
            items: [
              {
                id: "5001",
                url: `${origin}/c/sample-course/sections/1/lessons/5001`,
                fileTitle: "1.1 O que vai ser construido",
                folderPath: ["(Playlist) Sample Course", "1. Introducao"],
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
                folderPath: ["(Playlist) Sample Course", "1. Introducao"],
                itemIndex: 0,
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
        `chrome-extension://${extensionId}/playlist.html?scan=${scanId}`,
      );

      await expect(coursePage.locator(".item-meta").first()).toContainText(
        "2 videos · Portuguese · MD · 1 image",
      );

      const queuePagePromise = context.waitForEvent("page");

      await coursePage.click("#download-all");
      const queuePage = await queuePagePromise;

      try {
        await expect(queuePage.locator("#message")).toHaveText(
          "Playlist download finished",
          { timeout: 30000 },
        );

        expect(server.hitCount("direct-mp4")).toBe(1);

        const lessonFolder = join(
          downloadsDir,
          "HLS Videos",
          "(Playlist) Sample Course",
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

test("should recover from transient HTTP 503 throttling and resume sealed OPFS segments without re-fetching completed chunks", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const segmentBuffer = await generateTinyTsSegment(setupPage);
    const totalSegments = 110;
    const segmentHits = new Map<number, number>();

    const checkpointGate: {
      releaseHold: (() => void) | null;
      held: boolean;
      tripped503: boolean;
    } = {
      releaseHold: null,
      held: false,
      tripped503: false,
    };

    const holdPromise = new Promise<void>((resolve) => {
      checkpointGate.releaseHold = resolve;
    });

    const playlistBody = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:1",
      ...Array.from(
        { length: totalSegments },
        (_, i) => `#EXTINF:0.1,\nseg${i}.ts`,
      ),
      "#EXT-X-ENDLIST",
    ].join("\n");

    await context.route(
      "https://opfs-resume.example.test/**",
      async (route) => {
        const url = route.request().url();

        if (url.endsWith("/1080p/video.m3u8")) {
          await route.fulfill({
            status: 200,
            contentType: "application/vnd.apple.mpegurl",
            body: playlistBody,
          });

          return;
        }

        const match = /\/seg(\d+)\.ts$/.exec(url);

        if (!match) {
          await route.fulfill({ status: 404, body: "Not Found" });

          return;
        }

        const index = Number(match[1]);

        segmentHits.set(index, (segmentHits.get(index) || 0) + 1);

        if (index === 10 && !checkpointGate.tripped503) {
          checkpointGate.tripped503 = true;

          await route.fulfill({
            status: 503,
            headers: { "Retry-After": "0" },
            body: "Busy",
          });

          return;
        }

        if (index === 105 && !checkpointGate.held) {
          checkpointGate.held = true;
          await holdPromise;
          await route.abort("aborted").catch(() => {});

          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "video/mp2t",
          body: segmentBuffer,
        });
      },
    );

    const reqId = "e2e-opfs-checkpoint-resume";
    const resumeReqId = "e2e-opfs-checkpoint-resume-2";

    await setupPage.evaluate(
      async ({ firstId, secondId }) => {
        await chrome.storage.local.set({ segmentConcurrency: 5 });

        await chrome.storage.session.set({
          [`download-request:${firstId}`]: {
            url: "https://opfs-resume.example.test/token=old123&expires=999/asset/1080p/video.m3u8",
            selectedQualityUrl:
              "https://opfs-resume.example.test/token=old123&expires=999/asset/1080p/video.m3u8",
            selectedLabel: "1080p",
            title: "Large Stream Resume Test",
            sourceUrl: "https://training.example/c/large/sections/1/lessons/1",
            outputFormat: "mp4",
            autoStart: true,
            qualityOptions: [
              {
                url: "https://opfs-resume.example.test/token=old123&expires=999/asset/1080p/video.m3u8",
                label: "1080p",
              },
            ],
            subtitle: null,
          },
          [`download-request:${secondId}`]: {
            url: "https://opfs-resume.example.test/token=new456&expires=1999/asset/1080p/video.m3u8",
            selectedQualityUrl:
              "https://opfs-resume.example.test/token=new456&expires=1999/asset/1080p/video.m3u8",
            selectedLabel: "1080p",
            title: "Large Stream Resume Test",
            sourceUrl: "https://training.example/c/large/sections/1/lessons/1",
            outputFormat: "mp4",
            autoStart: true,
            qualityOptions: [
              {
                url: "https://opfs-resume.example.test/token=new456&expires=1999/asset/1080p/video.m3u8",
                label: "1080p",
              },
            ],
            subtitle: null,
          },
        });
      },
      { firstId: reqId, secondId: resumeReqId },
    );

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${reqId}`,
      );

      await expect(async () => {
        const value = await downloadPage
          .locator("#progress")
          .evaluate((element) => (element as HTMLProgressElement).value);

        expect(value).toBeGreaterThanOrEqual(100);
      }).toPass({ timeout: 25000 });

      await downloadPage.click("#cancel");
      checkpointGate.releaseHold?.();

      await expect(downloadPage.locator("#message")).toHaveText(
        "Download cancelled",
        { timeout: 15000 },
      );

      // Verify transient 503 triggered a retry on segment 10.
      expect(segmentHits.get(10)).toBe(2);

      // Reset hit counters and resume using a rotated signed URL token.
      segmentHits.clear();

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${resumeReqId}`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "MP4 download finished",
        { timeout: 30000 },
      );

      // Segments 0..99 were checkpointed into part-000001.ts and must NOT be re-fetched!
      for (const idx of Array.from({ length: 100 }, (_, i) => i)) {
        expect(segmentHits.get(idx) ?? 0).toBe(0);
      }

      // Only un-sealed tail segments (>= 100) were fetched on resume.
      expect(segmentHits.get(109)).toBe(1);

      const opfsDirs = await downloadPage.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];

        for await (const key of root.keys()) names.push(key);

        return names.filter((n) => n.startsWith("hls-resume-"));
      });

      expect(opfsDirs).toEqual([]);

      const outputBytes = await readFile(
        join(downloadsDir, "HLS Videos", "Large Stream Resume Test.mp4"),
      );

      expect(outputBytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
    } finally {
      await downloadPage.close().catch(() => {});
    }
  } finally {
    await setupPage.close().catch(() => {});
    await context.unroute("https://opfs-resume.example.test/**");
  }
});

test("should skip already-downloaded videos, subtitles, and materials on playlist re-download while restoring deleted files", async ({
  extensionFixture,
}) => {
  test.setTimeout(90000);
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const segmentBuffer = await generateTinyTsSegment(setupPage);
    const server = await startMaterialsE2eServer(segmentBuffer);
    const baseUrl = `http://materials.example.test:${server.port}`;

    const createPlan = (origin: string) => ({
      title: "Skip Existing Course",
      outputFormat: "mp4",
      playlistQualityPreference: "best",
      subtitleDownloadPreference: "include",
      segmentConcurrency: 3,
      completedItemIndices: [],
      items: [
        {
          itemIndex: 0,
          title: "1.1 Intro",
          url: `${origin}/video/playlist.m3u8`,
          sourceUrl: `${origin}/c/skip/sections/1/lessons/1`,
          kind: "media",
          folderPath: ["(Playlist) Skip Existing"],
          qualityOptions: [
            { label: "720p", url: `${origin}/video/playlist.m3u8` },
          ],
          subtitles: [
            {
              url: `${origin}/video/mojibake.vtt`,
              language: "Portuguese",
              label: "Portuguese",
            },
          ],
          documents: {
            markdown: "# 1.1 Intro\n\nConteudo.\n",
            images: [
              {
                kind: "image",
                url: `${origin}/redirect-img`,
                filename: "diagram.png",
                contentType: "image/png",
              },
            ],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
        {
          itemIndex: 1,
          title: "1.2 Direct Event",
          url: `${origin}/video/live-event.mp4`,
          sourceUrl: `${origin}/c/skip/sections/1/lessons/2`,
          kind: "direct",
          folderPath: ["(Playlist) Skip Existing"],
          qualityOptions: [],
          subtitles: [],
          documents: {
            markdown: "# 1.2 Direct Event\n\nResumo.\n",
            images: [],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
      ],
    });

    await setupPage.evaluate(
      async ({ plan1, plan2, plan3 }) => {
        await chrome.storage.session.set({
          "playlist-download:skip-1": plan1,
          "playlist-download:skip-2": plan2,
          "playlist-download:skip-3": plan3,
        });
      },
      {
        plan1: createPlan(baseUrl),
        plan2: createPlan(baseUrl),
        plan3: createPlan(baseUrl),
      },
    );

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=skip-1`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 30000 },
      );

      const courseDir = join(
        downloadsDir,
        "HLS Videos",
        "(Playlist) Skip Existing",
      );

      const firstRunFiles = await readdir(courseDir);

      expect(firstRunFiles).toContain("1.1 Intro.mp4");
      expect(firstRunFiles).toContain("1.1 Intro.vtt");
      expect(firstRunFiles).toContain("1.1 Intro.md");
      expect(firstRunFiles).toContain("1.1 diagram.png");
      expect(firstRunFiles).toContain("1.2 Direct Event.mp4");
      expect(firstRunFiles).toContain("1.2 Direct Event.md");

      const segHitsBefore = server.hitCount("seg0");
      const vttHitsBefore = server.hitCount("vtt");
      const imgHitsBefore = server.hitCount("image");
      const directHitsBefore = server.hitCount("direct-mp4");

      expect(segHitsBefore).toBe(1);
      expect(vttHitsBefore).toBeGreaterThanOrEqual(1);
      expect(imgHitsBefore).toBe(1);
      expect(directHitsBefore).toBe(1);

      // Re-run the playlist with a fresh course plan: every existing file must be skipped!
      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=skip-2`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 15000 },
      );

      await expect(downloadPage.locator("#playlist-download-note")).toHaveText(
        "2 items already downloaded (skipped).",
      );

      expect(server.hitCount("seg0")).toBe(segHitsBefore);
      expect(server.hitCount("vtt")).toBe(vttHitsBefore);
      expect(server.hitCount("image")).toBe(imgHitsBefore);
      expect(server.hitCount("direct-mp4")).toBe(directHitsBefore);

      const secondRunFiles = await readdir(courseDir);

      expect(secondRunFiles).toEqual(firstRunFiles);

      // Delete only the VTT subtitle and re-run: video stays skipped, only VTT is fetched!
      await rm(join(courseDir, "1.1 Intro.vtt"));

      await expect(async () => {
        const items = await setupPage.evaluate(() =>
          chrome.downloads.search({ state: "complete", exists: true }),
        );

        expect(
          items.some((item) =>
            (item.filename || "").toLowerCase().endsWith("1.1 intro.vtt"),
          ),
        ).toBe(false);
      }).toPass({ timeout: 25000 });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=skip-3`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 15000 },
      );

      expect(server.hitCount("seg0")).toBe(segHitsBefore);
      expect(server.hitCount("image")).toBe(imgHitsBefore);
      expect(server.hitCount("direct-mp4")).toBe(directHitsBefore);
      expect(server.hitCount("vtt")).toBeGreaterThan(vttHitsBefore);

      const thirdRunFiles = await readdir(courseDir);

      expect(thirdRunFiles).toContain("1.1 Intro.vtt");
    } finally {
      await downloadPage.close().catch(() => {});
      await server.close();
    }
  } finally {
    await setupPage.close().catch(() => {});
  }
});
