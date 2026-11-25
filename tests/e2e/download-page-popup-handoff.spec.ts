import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/extension.ts";

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
