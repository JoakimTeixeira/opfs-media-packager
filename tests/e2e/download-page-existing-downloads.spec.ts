import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures.ts";
import { generateTinyTsSegment } from "./download-page-fixtures.ts";
import { startMaterialsE2eServer } from "./download-page-materials-server.ts";

test("should skip already-downloaded videos, subtitles, and materials on playlist re-download while restoring deleted files", async ({
  extensionFixture,
}) => {
  test.setTimeout(90000);
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const segmentBuffer = await generateTinyTsSegment(setupPage);
    const server = await startMaterialsE2eServer(segmentBuffer);
    const baseUrl = `http://materials.example.test:${server.port}`;

    const createPlan = (origin: string) => ({
      title: "Skip Existing Course",
      outputFormat: "mp4",
      playlistQualityPreference: "best",
      subtitleDownloadPreference: "include",
      segmentConcurrency: 3,
      completedItemIndices: [],
      items: [
        {
          itemIndex: 0,
          title: "1.1 Intro",
          url: `${origin}/video/playlist.m3u8`,
          sourceUrl: `${origin}/c/skip/sections/1/lessons/1`,
          kind: "media",
          folderPath: ["(Playlist) Skip Existing"],
          qualityOptions: [
            { label: "720p", url: `${origin}/video/playlist.m3u8` },
          ],
          subtitles: [
            {
              url: `${origin}/video/mojibake.vtt`,
              language: "Portuguese",
              label: "Portuguese",
            },
          ],
          documents: {
            markdown: "# 1.1 Intro\n\nConteudo.\n",
            images: [
              {
                kind: "image",
                url: `${origin}/redirect-img`,
                filename: "diagram.png",
                contentType: "image/png",
              },
            ],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
        {
          itemIndex: 1,
          title: "1.2 Direct Event",
          url: `${origin}/video/live-event.mp4`,
          sourceUrl: `${origin}/c/skip/sections/1/lessons/2`,
          kind: "direct",
          folderPath: ["(Playlist) Skip Existing"],
          qualityOptions: [],
          subtitles: [],
          documents: {
            markdown: "# 1.2 Direct Event\n\nResumo.\n",
            images: [],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
      ],
    });

    await setupPage.evaluate(
      async ({ plan1, plan2, plan3 }) => {
        await chrome.storage.session.set({
          "playlist-download:skip-1": plan1,
          "playlist-download:skip-2": plan2,
          "playlist-download:skip-3": plan3,
        });
      },
      {
        plan1: createPlan(baseUrl),
        plan2: createPlan(baseUrl),
        plan3: createPlan(baseUrl),
      },
    );

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=skip-1`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 30000 },
      );

      const courseDir = join(
        downloadsDir,
        "HLS Videos",
        "(Playlist) Skip Existing",
      );

      const firstRunFiles = await readdir(courseDir);

      expect(firstRunFiles).toContain("1.1 Intro.mp4");
      expect(firstRunFiles).toContain("1.1 Intro.vtt");
      expect(firstRunFiles).toContain("1.1 Intro.md");
      expect(firstRunFiles).toContain("1.1 diagram.png");
      expect(firstRunFiles).toContain("1.2 Direct Event.mp4");
      expect(firstRunFiles).toContain("1.2 Direct Event.md");

      const segHitsBefore = server.hitCount("seg0");
      const vttHitsBefore = server.hitCount("vtt");
      const imgHitsBefore = server.hitCount("image");
      const directHitsBefore = server.hitCount("direct-mp4");

      expect(segHitsBefore).toBe(1);
      expect(vttHitsBefore).toBeGreaterThanOrEqual(1);
      expect(imgHitsBefore).toBe(1);
      expect(directHitsBefore).toBe(1);

      // Re-run the playlist with a fresh course plan: every existing file must be skipped!
      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=skip-2`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 15000 },
      );

      await expect(downloadPage.locator("#playlist-download-note")).toHaveText(
        "2 items already downloaded (skipped).",
      );

      expect(server.hitCount("seg0")).toBe(segHitsBefore);
      expect(server.hitCount("vtt")).toBe(vttHitsBefore);
      expect(server.hitCount("image")).toBe(imgHitsBefore);
      expect(server.hitCount("direct-mp4")).toBe(directHitsBefore);

      const secondRunFiles = await readdir(courseDir);

      expect(secondRunFiles).toEqual(firstRunFiles);

      // Delete only the VTT subtitle and re-run: video stays skipped, only VTT is fetched!
      await rm(join(courseDir, "1.1 Intro.vtt"));

      await expect(async () => {
        const items = await setupPage.evaluate(() =>
          chrome.downloads.search({ state: "complete", exists: true }),
        );

        expect(
          items.some((item) =>
            (item.filename || "").toLowerCase().endsWith("1.1 intro.vtt"),
          ),
        ).toBe(false);
      }).toPass({ timeout: 25000 });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?playlist=skip-3`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "Playlist download finished",
        { timeout: 15000 },
      );

      expect(server.hitCount("seg0")).toBe(segHitsBefore);
      expect(server.hitCount("image")).toBe(imgHitsBefore);
      expect(server.hitCount("direct-mp4")).toBe(directHitsBefore);
      expect(server.hitCount("vtt")).toBeGreaterThan(vttHitsBefore);

      const thirdRunFiles = await readdir(courseDir);

      expect(thirdRunFiles).toContain("1.1 Intro.vtt");
    } finally {
      await downloadPage.close().catch(() => {});
      await server.close();
    }
  } finally {
    await setupPage.close().catch(() => {});
  }
});
