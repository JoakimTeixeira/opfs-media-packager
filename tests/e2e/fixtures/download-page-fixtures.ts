import { type Page } from "@playwright/test";
import { expect } from "./extension.ts";

export async function generateTinyTsSegment(
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

export const downloadRequest = Object.freeze({
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

export const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

export const SAMPLE_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "ascii",
);

export function buildDoubleEncodedPortugueseVtt(): Buffer {
  const cleanText =
    "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:04.000\r\nVamos começar a 1º aula! É então possível.\r\n";

  const cleanBytes = Buffer.from(cleanText, "utf8");

  // Simulate Windows-1252 interpretation of UTF-8 bytes re-saved as UTF-8.
  const mojibake = Array.from(cleanBytes, (byte) =>
    String.fromCharCode(byte),
  ).join("");

  return Buffer.from(mojibake, "utf8");
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

export const E2E_SLIDES_HTML = `<!doctype html><html><head><style>
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

export const E2E_EXCALIDRAW_HTML = `<!doctype html><html><body>
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

export const DIRECT_MP4_E2E_BYTES = Buffer.from(
  "ftypmp42-e2e-direct-video-stream",
);
