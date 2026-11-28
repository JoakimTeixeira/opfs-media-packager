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

export async function generateTinyFmp4Streams(page: Page): Promise<{
  readonly videoInit: Buffer;
  readonly videoSegment: Buffer;
  readonly audioInit: Buffer;
  readonly audioSegment: Buffer;
}> {
  const encoded = await page.evaluate(async () => {
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

    const videoCode = await ffmpeg.exec([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:d=0.1:r=10",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+frag_keyframe+empty_moov+default_base_moof",
      "video-fmp4.mp4",
    ]);

    if (videoCode !== 0) {
      throw new Error(`FFmpeg video fMP4 fixture failed: ${videoCode}`);
    }

    const audioCode = await ffmpeg.exec([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.1",
      "-c:a",
      "aac",
      "-movflags",
      "+frag_keyframe+empty_moov+default_base_moof",
      "audio-fmp4.mp4",
    ]);

    if (audioCode !== 0) {
      throw new Error(`FFmpeg audio fMP4 fixture failed: ${audioCode}`);
    }

    const splitInitAndMoof = (
      bytes: Uint8Array,
    ): { readonly init: string; readonly segment: string } => {
      const moofIndex = bytes.findIndex(
        (_byte, index) =>
          index + 4 <= bytes.length &&
          bytes[index] === 0x6d &&
          bytes[index + 1] === 0x6f &&
          bytes[index + 2] === 0x6f &&
          bytes[index + 3] === 0x66,
      );

      const splitAt =
        moofIndex >= 4 ? moofIndex - 4 : Math.floor(bytes.length / 2);

      return {
        init: btoa(String.fromCharCode(...bytes.subarray(0, splitAt))),
        segment: btoa(String.fromCharCode(...bytes.subarray(splitAt))),
      };
    };

    const video = splitInitAndMoof(await ffmpeg.readFile("video-fmp4.mp4"));
    const audio = splitInitAndMoof(await ffmpeg.readFile("audio-fmp4.mp4"));

    ffmpeg.terminate();

    return { video, audio };
  });

  return {
    videoInit: Buffer.from(encoded.video.init, "base64"),
    videoSegment: Buffer.from(encoded.video.segment, "base64"),
    audioInit: Buffer.from(encoded.audio.init, "base64"),
    audioSegment: Buffer.from(encoded.audio.segment, "base64"),
  };
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
