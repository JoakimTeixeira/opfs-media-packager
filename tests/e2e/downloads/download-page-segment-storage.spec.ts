import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../support/extension.ts";
import { generateTinyTsSegment } from "./support/download-actions.ts";

test("should stream segments through OPFS with discontinuity splitting, sweep stale temp dirs, and fall back to MEMFS when OPFS is unavailable", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/src/index.html`);
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
        `chrome-extension://${extensionId}/src/index.html?download-request=${opfsReqId}`,
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
        `chrome-extension://${extensionId}/src/index.html?download-request=${fallbackReqId}`,
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
