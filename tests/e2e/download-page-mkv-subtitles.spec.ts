import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures.ts";
import { generateTinyTsSegment } from "./download-page-fixtures.ts";

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
