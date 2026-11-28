import { type Page } from "@playwright/test";
import { expect } from "../../support/extension.ts";

export async function generateTinyTsSegment(
  page: Page,
  withAudio = false,
): Promise<Buffer> {
  const segmentBase64 = await page.evaluate(async (includeAudio) => {
    const { FFmpeg } = (await import(
      chrome.runtime.getURL("vendor/ffmpeg/classes.js")
    )) as {
      FFmpeg: new () => {
        load(config: Record<string, string>): Promise<void>;
        exec(args: string[]): Promise<number>;
        readFile(path: string): Promise<Uint8Array>;
        terminate(): void;
      };
    };

    const ffmpeg = new FFmpeg();

    await ffmpeg.load({
      classWorkerURL: chrome.runtime.getURL("vendor/ffmpeg/worker.js"),
      coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm"),
    });

    const code = await ffmpeg.exec([
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
    const bytes = await ffmpeg.readFile("tiny.ts");

    ffmpeg.terminate();

    return btoa(String.fromCharCode(...bytes));
  }, withAudio);

  return Buffer.from(segmentBase64, "base64");
}

export async function runMaterialsOnlyCourseFromCoursePage(
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
      `chrome-extension://${extensionId}/src/track.html?scan=${scanId}`,
    );

    await expect(coursePage.locator("#track-download-mode")).toHaveValue("all");

    await expect(coursePage.locator("#selection-count")).toHaveText(
      "2 of 2 topics selected",
    );

    await expect(coursePage.locator("#download-all")).toBeEnabled();

    await expect(coursePage.locator("#download-all")).toHaveText(
      "Download all 2 topics",
    );

    await expect(coursePage.locator(".topic-select").first()).toBeChecked();

    await coursePage.selectOption("#track-download-mode", "documents");
    await expect(coursePage.locator("#format")).toBeDisabled();
    await expect(coursePage.locator("#download-all")).toBeEnabled();

    await coursePage.selectOption("#track-download-mode", "all");
    await expect(coursePage.locator("#format")).toBeEnabled();
    await expect(coursePage.locator("#download-all")).toBeEnabled();

    await expect(coursePage.locator(".topic-meta").first()).toContainText(
      "MD · 1 PDF · 1 image · 1 diagram · 1 slides",
    );

    const queuePagePromise = context.waitForEvent("page");

    await coursePage.click("#download-all");
    const queuePage = await queuePagePromise;

    try {
      await expect(queuePage.locator("#message")).toHaveText(
        "Track download finished",
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
