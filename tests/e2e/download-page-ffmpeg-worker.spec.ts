import { test, expect } from "./fixtures.ts";

test("should load the FFmpeg worker from the vendor path used by the bundled page", async ({
  extensionFixture,
}) => {
  const { context, extensionId } = extensionFixture;
  const page = await context.newPage();

  try {
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await expect(
      page.evaluate(async () => {
        const workerUrl = chrome.runtime.getURL("vendor/ffmpeg/worker.js");
        const worker = new Worker(workerUrl, { type: "module" });

        return await new Promise<boolean>((done, fail) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            done(true);
          }, 250);

          worker.addEventListener("error", () => {
            clearTimeout(timeout);
            worker.terminate();
            fail(new Error("Vendor FFmpeg worker did not load."));
          });
        });
      }),
    ).resolves.toBe(true);
  } finally {
    await page.close();
  }
});
