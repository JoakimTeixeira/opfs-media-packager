import { test, expect } from "./fixtures.ts";

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
