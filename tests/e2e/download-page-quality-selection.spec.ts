import { test, expect } from "./fixtures/extension.ts";
import { downloadRequest } from "./fixtures/download-page-fixtures.ts";

test("should keep every supplied quality selectable before and after a refresh", async ({
  extensionFixture,
}) => {
  const { context, extensionId, serviceWorker } = extensionFixture;

  await serviceWorker.evaluate(async (download) => {
    await chrome.storage.session.set({ "download-request:e2e": download });
  }, downloadRequest);

  const page = await context.newPage();

  try {
    await page.goto(
      `chrome-extension://${extensionId}/index.html?download-request=e2e`,
    );

    const quality = page.locator("#quality");

    await expect(quality).toBeEnabled();

    await expect(quality.locator("option")).toHaveText([
      "720p",
      "480p",
      "360p",
      "240p",
    ]);

    await expect(page.locator("#cancel")).toBeHidden();
    await expect(page.locator("#filename")).toBeEnabled();
    await expect(page.locator("#container")).toBeEnabled();
    await expect(page.locator("#concurrency")).toBeEnabled();
    await expect(page.locator("#download-subfolder")).toBeEnabled();
    await page.reload();
    await expect(quality).toBeEnabled();

    await expect(quality.locator("option")).toHaveText([
      "720p",
      "480p",
      "360p",
      "240p",
    ]);

    await expect(page.locator("#cancel")).toBeHidden();
    await expect(page.locator("#filename")).toBeEnabled();
    await expect(page.locator("#container")).toBeEnabled();
    await expect(page.locator("#concurrency")).toBeEnabled();
    await expect(page.locator("#download-subfolder")).toBeEnabled();
  } finally {
    await page.close();
  }
});
