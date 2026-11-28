import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  syntheticOpaqueAssetUrl,
  syntheticOpaqueToken,
} from "../../../lib/materials/__fixtures__/attachment-tokens.ts";
import { test, expect } from "../support/extension.ts";
import { generateTinyFmp4Streams } from "./support/download-actions.ts";

test("should remux fMP4 HLS video with separate fMP4 audio track, VTT subtitle, and attached PPTX document", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(`chrome-extension://${extensionId}/src/index.html`);

    const fmp4 = await generateTinyFmp4Streams(setupPage);
    const pptxPayload = Buffer.from("PK\x03\x04fake-pptx-presentation-bytes");
    const deckToken = syntheticOpaqueToken("e2e-sample-deck");

    const deckUrl = syntheticOpaqueAssetUrl(
      "e2e-sample-deck",
      "https://media.example.test",
    );

    await context.route("https://media.example.test/**", async (route) => {
      const url = route.request().url();

      if (url.endsWith("/sep/master.m3u8")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: [
            "#EXTM3U",
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio/index.m3u8"',
            '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080,AUDIO="audio-high"',
            "video/1080p.m3u8",
          ].join("\n"),
        });

        return;
      }

      if (url.endsWith("/sep/video/1080p.m3u8")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-TARGETDURATION:1",
            '#EXT-X-MAP:URI="init.mp4"',
            "#EXTINF:0.1,",
            "seg0.m4s",
            "#EXT-X-ENDLIST",
          ].join("\n"),
        });

        return;
      }

      if (url.endsWith("/sep/video/init.mp4")) {
        await route.fulfill({
          status: 200,
          contentType: "video/mp4",
          body: fmp4.videoInit,
        });

        return;
      }

      if (url.endsWith("/sep/video/seg0.m4s")) {
        await route.fulfill({
          status: 200,
          contentType: "video/iso.segment",
          body: fmp4.videoSegment,
        });

        return;
      }

      if (url.endsWith("/sep/audio/index.m3u8")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-TARGETDURATION:1",
            '#EXT-X-MAP:URI="init.mp4"',
            "#EXTINF:0.1,",
            "seg0.m4s",
            "#EXT-X-ENDLIST",
          ].join("\n"),
        });

        return;
      }

      if (url.endsWith("/sep/audio/init.mp4")) {
        await route.fulfill({
          status: 200,
          contentType: "audio/mp4",
          body: fmp4.audioInit,
        });

        return;
      }

      if (url.endsWith("/sep/audio/seg0.m4s")) {
        await route.fulfill({
          status: 200,
          contentType: "audio/mp4",
          body: fmp4.audioSegment,
        });

        return;
      }

      if (url.endsWith("/en.vtt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/vtt",
          body: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nWelcome to the sample module.\n",
        });

        return;
      }

      if (url.endsWith(`/${deckToken}`)) {
        await route.fulfill({
          status: 200,
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          body: pptxPayload,
        });

        return;
      }

      await route.fulfill({ status: 404, body: "Not found" });
    });

    const requestId = "e2e-fmp4-separate-audio";

    await setupPage.evaluate(
      async ({ id, attachmentUrl }) => {
        await chrome.storage.session.set({
          [`download-request:${id}`]: {
            url: "https://media.example.test/sep/master.m3u8",
            selectedQualityUrl:
              "https://media.example.test/sep/video/1080p.m3u8",
            selectedLabel: "1080p (1920×1080)",
            title: "Sample Lesson",
            sourceUrl:
              "https://training.example/c/sample-track/sections/700/lessons/2001",
            outputFormat: "mp4",
            autoStart: true,
            qualityOptions: [
              {
                url: "https://media.example.test/sep/video/1080p.m3u8",
                label: "1080p (1920×1080)",
                audioUri: "https://media.example.test/sep/audio/index.m3u8",
              },
            ],
            subtitle: {
              url: "https://media.example.test/en.vtt",
              language: "English",
              label: "English",
            },
            documents: {
              markdown: "# Sample Lesson\n\nOverview notes.\n",
              images: [],
              pdfs: [],
              files: [
                {
                  kind: "pptx",
                  url: attachmentUrl,
                  filename: "Sample Deck.pptx",
                  contentType:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                },
              ],
              diagrams: [],
              slides: [],
            },
          },
        });
      },
      { id: requestId, attachmentUrl: deckUrl },
    );

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/src/index.html?download-request=${requestId}`,
      );

      await expect(downloadPage.locator("#message")).toContainText("finished", {
        timeout: 30000,
      });

      const targetDir = join(downloadsDir, "HLS Videos");

      await expect
        .poll(async () => {
          const entries = await readdir(targetDir).catch(() => []);

          return entries.sort();
        })
        .toEqual([
          "Sample Deck.pptx",
          "Sample Lesson.md",
          "Sample Lesson.mp4",
          "Sample Lesson.vtt",
        ]);

      const savedMp4 = await readFile(join(targetDir, "Sample Lesson.mp4"));
      const savedPptx = await readFile(join(targetDir, "Sample Deck.pptx"));

      expect(savedMp4.includes(Buffer.from("ftyp"))).toBe(true);
      expect(savedMp4.includes(Buffer.from("soun"))).toBe(true);
      expect(savedMp4.includes(Buffer.from("vide"))).toBe(true);
      expect(savedPptx.equals(pptxPayload)).toBe(true);
    } finally {
      await downloadPage.close().catch(() => {});
    }
  } finally {
    await setupPage.close().catch(() => {});
  }
});
