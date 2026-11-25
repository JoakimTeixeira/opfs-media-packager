import { test, expect } from "./fixtures.ts";

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
