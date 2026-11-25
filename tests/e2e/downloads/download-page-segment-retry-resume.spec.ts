import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../support/extension.ts";
import { generateTinyTsSegment } from "./support/download-actions.ts";

test("should recover from transient HTTP 503 throttling and resume sealed OPFS segments without re-fetching completed chunks", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/src/index.html`);
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
        `chrome-extension://${extensionId}/src/index.html?download-request=${reqId}`,
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
        `chrome-extension://${extensionId}/src/index.html?download-request=${resumeReqId}`,
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
