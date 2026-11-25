import { test, expect } from "./fixtures.ts";

test("should display subtitle language (never generic Subtitle) and filter selected lessons on playlist.html", async ({
  extensionFixture,
}) => {
  const { context, extensionId, serviceWorker } = extensionFixture;

  await serviceWorker.evaluate(async () => {
    await chrome.storage.session.set({
      "playlist-scan:ui-e2e": {
        id: "ui-e2e",
        title: "Distributed Systems",
        status: "ready",
        nextItemIndex: 3,
        items: [
          {
            id: "1",
            url: "https://training.example/courses/a?conteudo=1",
            fileTitle: "1.1 Intro",
            folderPath: ["Playlist"],
          },
          {
            id: "2",
            url: "https://training.example/courses/a?conteudo=2",
            fileTitle: "1.2 Messaging",
            folderPath: ["Playlist"],
          },
          {
            id: "3",
            url: "https://training.example/courses/a?conteudo=3",
            fileTitle: "1.3 Storage",
            folderPath: ["Playlist"],
          },
        ],
        discovered: [
          {
            itemIndex: 0,
            title: "1.1 Intro",
            folderPath: ["Playlist"],
            url: "https://media.example.net/1/playlist.m3u8",
            qualityOptions: [
              { label: "1080p", url: "https://media.example.net/1/1080.m3u8" },
              { label: "720p", url: "https://media.example.net/1/720.m3u8" },
              { label: "480p", url: "https://media.example.net/1/480.m3u8" },
            ],
            subtitles: [
              {
                url: "https://media.example.net/1/pt.vtt",
                language: "Portuguese",
                label: "pt.vtt",
              },
            ],
          },
          {
            itemIndex: 1,
            title: "1.2 Messaging",
            folderPath: ["Playlist"],
            url: "https://media.example.net/2/playlist.m3u8",
            qualityOptions: [
              { label: "720p", url: "https://media.example.net/2/720.m3u8" },
            ],
            subtitles: [
              {
                url: "https://media.example.net/2/en.vtt",
                language: "English",
                label: "en.vtt",
              },
            ],
          },
          {
            itemIndex: 2,
            title: "1.3 Storage",
            folderPath: ["Playlist"],
            url: "https://media.example.net/3/playlist.m3u8",
            qualityOptions: [
              { label: "1080p", url: "https://media.example.net/3/1080.m3u8" },
            ],
            subtitles: [],
          },
        ],
      },
    });
  });

  const page = await context.newPage();

  try {
    await page.goto(
      `chrome-extension://${extensionId}/playlist.html?scan=ui-e2e`,
    );

    await expect(page.locator("#items li")).toHaveCount(3);

    await expect(page.locator(".item-meta").nth(0)).toHaveText(
      "3 quality options · Portuguese",
    );

    await expect(page.locator(".item-meta").nth(1)).toHaveText(
      "1 quality option · English",
    );

    await expect(page.locator("#selection-count")).toHaveText(
      "3 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toHaveText(
      "Download all 3 items",
    );

    await page.locator(".item-select").nth(1).uncheck();

    await expect(page.locator("#selection-count")).toHaveText(
      "2 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toHaveText(
      "Download 2 selected items",
    );

    await page.locator("#deselect-all").click();

    await expect(page.locator("#selection-count")).toHaveText(
      "0 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toBeDisabled();

    await page.locator("#select-all").click();

    await expect(page.locator("#selection-count")).toHaveText(
      "3 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toBeEnabled();
  } finally {
    await page.close();
  }
});
