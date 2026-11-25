import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./fixtures/extension.ts";
import {
  generateTinyTsSegment,
  runMaterialsOnlyCourseFromCoursePage,
  TINY_PNG_BYTES,
} from "./fixtures/download-page-fixtures.ts";
import { startMaterialsE2eServer } from "./fixtures/download-page-materials-server.ts";

test("should repair double-encoded Portuguese VTT subtitles (preserving CRLF) and support Materials-only course downloads with sanitized annotated Markdown, deduplicated URLs, headless Excalidraw 1x SVG, and 3-slide PDF", async ({
  extensionFixture,
}) => {
  const { context, downloadsDir, extensionId } = extensionFixture;
  const setupPage = await context.newPage();

  await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
  const segmentBuffer = await generateTinyTsSegment(setupPage);
  const server = await startMaterialsE2eServer(segmentBuffer);
  const baseUrl = `http://materials.example.test:${server.port}`;
  const excalidrawUrl = `http://e2e.excalidraw.com:${server.port}/s/test-room/scene-1`;

  try {
    // 1. Verify double-encoded Portuguese VTT repair through the real app.ts download pipeline.
    const vttReqId = "e2e-vtt-encoding";

    await setupPage.evaluate(
      async ({ id, origin }) => {
        await chrome.storage.session.set({
          [`download-request:${id}`]: {
            url: `${origin}/video/playlist.m3u8`,
            selectedQualityUrl: `${origin}/video/playlist.m3u8`,
            selectedLabel: "720p (1280×720)",
            title: "2.4 Contexto e Português",
            sourceUrl:
              "https://training.example/c/workshop/sections/2/lessons/4",
            outputFormat: "mp4",
            autoStart: true,
            qualityOptions: [
              {
                url: `${origin}/video/playlist.m3u8`,
                label: "720p (1280×720)",
              },
            ],
            subtitle: {
              url: `${origin}/video/mojibake.vtt`,
              language: "Portuguese",
              label: "Portuguese",
            },
          },
        });
      },
      { id: vttReqId, origin: baseUrl },
    );

    const downloadPage = await context.newPage();

    try {
      const cdp = await context.newCDPSession(downloadPage);

      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

      await downloadPage.goto(
        `chrome-extension://${extensionId}/index.html?download-request=${vttReqId}`,
      );

      await expect(downloadPage.locator("#message")).toHaveText(
        "MP4 and subtitle finished",
        { timeout: 25000 },
      );

      const repairedVtt = await readFile(
        join(downloadsDir, "HLS Videos", "2.4 Contexto e Português.vtt"),
        "utf8",
      );

      expect(repairedVtt).toContain(
        "Vamos começar a 1º aula! É então possível.",
      );

      expect(repairedVtt).not.toContain("Ã§");
      expect(repairedVtt).toContain("\r\n");

      // 2. Verify playlist.html default "all" -> "documents" mode, headless Excalidraw, URL dedup, and annotated Markdown across 2 lessons.
      const scanId = "e2e-materials-scan";

      await setupPage.evaluate(
        async ({ diagramUrl, id, origin }) => {
          await chrome.storage.session.set({
            [`playlist-scan:${id}`]: {
              id,
              title: "Workshop Materials",
              status: "ready",
              rateLimited: false,
              nextItemIndex: 2,
              currentItemIndex: null,
              sourceTabId: null,
              startedAt: Date.now(),
              items: [
                {
                  id: "101",
                  url: "https://training.example/c/workshop/sections/1/lessons/101",
                  fileTitle: "1.1 Arquitetura Completa",
                  folderPath: ["1. Dia 1"],
                },
                {
                  id: "102",
                  url: "https://training.example/c/workshop/sections/2/lessons/102",
                  fileTitle: "1.2 Revisao e Links",
                  folderPath: ["2. Dia 2"],
                },
              ],
              discovered: [
                {
                  key: "documents:0",
                  url: "",
                  host: "",
                  title: "1.1 Arquitetura Completa",
                  sourceUrl:
                    "https://training.example/c/workshop/sections/1/lessons/101",
                  kind: "media",
                  qualityOptions: [],
                  subtitles: [],
                  detectedAt: Date.now(),
                  folderPath: ["1. Dia 1"],
                  itemIndex: 0,
                  documents: {
                    markdown: [
                      "# 1.1 Arquitetura Completa",
                      "",
                      "•\uFE0F\uFFFC [https://tool-one.example/](https://tool-one.example/)",
                      "•\u200B [https://tool-two.example/](https://tool-two.example/)",
                      "",
                      "## **Slides**",
                      "",
                      `[Slides do case](${origin}/slides?slide=9)`,
                      "",
                      `[Diagrama](${diagramUrl})`,
                      "",
                      `[Guia PDF](${origin}/redirect-pdf)`,
                      "",
                      "## Conteúdos relacionados na comunidade",
                      "",
                      "- [Post relacionado](https://training.example/c/workshop/sections/1/lessons/999)",
                      "",
                    ].join("\n"),
                    pdfs: [
                      {
                        kind: "pdf",
                        url: `${origin}/redirect-pdf`,
                        filename: "Apostila do Modulo.pdf",
                        contentType: "application/pdf",
                      },
                    ],
                    images: [
                      {
                        kind: "image",
                        url: `${origin}/redirect-img`,
                        filename: "Fluxo Geral.png",
                        contentType: "image/png",
                      },
                    ],
                    diagrams: [
                      {
                        kind: "diagram",
                        url: diagramUrl,
                        title: "Diagrama Teste",
                      },
                    ],
                    slides: [
                      {
                        kind: "slides",
                        url: `${origin}/slides?slide=9`,
                        title: "Slides Teste",
                      },
                    ],
                  },
                },
                {
                  key: "documents:1",
                  url: "",
                  host: "",
                  title: "1.2 Revisao e Links",
                  sourceUrl:
                    "https://training.example/c/workshop/sections/2/lessons/102",
                  kind: "media",
                  qualityOptions: [],
                  subtitles: [],
                  detectedAt: Date.now(),
                  folderPath: ["2. Dia 2"],
                  itemIndex: 1,
                  documents: {
                    markdown: [
                      "# 1.2 Revisao e Links",
                      "",
                      "## **Slides**",
                      "",
                      `[Slides do case](${origin}/slides?slide=2)`,
                      "",
                      `[Diagrama](${diagramUrl})`,
                      "",
                    ].join("\n"),
                    pdfs: [
                      {
                        kind: "pdf",
                        url: `${origin}/redirect-pdf`,
                        filename: "Apostila do Modulo.pdf",
                        contentType: "application/pdf",
                      },
                    ],
                    images: [
                      {
                        kind: "image",
                        url: `${origin}/redirect-img`,
                        filename: "Fluxo Geral.png",
                        contentType: "image/png",
                      },
                    ],
                    diagrams: [
                      {
                        kind: "diagram",
                        url: diagramUrl,
                        title: "Diagrama Teste",
                      },
                    ],
                    slides: [
                      {
                        kind: "slides",
                        url: `${origin}/slides?slide=2`,
                        title: "Slides Teste",
                      },
                    ],
                  },
                },
              ],
            },
          });
        },
        { diagramUrl: excalidrawUrl, id: scanId, origin: baseUrl },
      );

      const openedUrls = await runMaterialsOnlyCourseFromCoursePage(
        context,
        extensionId,
        scanId,
      );

      expect(
        openedUrls.some(
          (url) => url.includes("excalidraw") || url.includes("/slides"),
        ),
      ).toBe(false);

      expect(server.hitCount("diagram")).toBe(1);
      expect(server.hitCount("redirect-pdf")).toBe(1);
      expect(server.hitCount("pdf")).toBe(1);
      expect(server.hitCount("redirect-img")).toBe(1);
      expect(server.hitCount("image")).toBe(1);
      expect(server.hitCount("slides")).toBe(1);

      const folder1 = join(downloadsDir, "HLS Videos", "1. Dia 1");
      const folder2 = join(downloadsDir, "HLS Videos", "2. Dia 2");

      const md1 = await readFile(
        join(folder1, "1.1 Arquitetura Completa.md"),
        "utf8",
      );

      expect(md1).toContain(
        "- [https://tool-one.example/](https://tool-one.example/)",
      );

      expect(md1).toContain(
        "- [https://tool-two.example/](https://tool-two.example/)",
      );

      expect(md1).not.toMatch(/[\uFE0F\u200B\uFFFC\uFFFD]/);
      expect(md1).not.toContain("Conteúdos relacionados");
      expect(md1).not.toContain("Post relacionado");
      expect(md1).toContain("— Baixado como `1.1 Slides Teste.pdf`");
      expect(md1).toContain("— Baixado como `1.1 Diagrama Teste.svg`");
      expect(md1).toContain("— Baixado como `1.1 Apostila do Modulo.pdf`");
      expect(md1).toContain("- Imagem: `1.1 Fluxo Geral.png` (baixado)");

      const pdfBytes = await readFile(
        join(folder1, "1.1 Apostila do Modulo.pdf"),
      );

      expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      const pngBytes = await readFile(join(folder1, "1.1 Fluxo Geral.png"));

      expect(pngBytes.equals(TINY_PNG_BYTES)).toBe(true);

      const svgText = await readFile(
        join(folder1, "1.1 Diagrama Teste.svg"),
        "utf8",
      );

      expect(svgText).toContain('data-scale="1"');
      expect(svgText).toContain("<svg");

      const slidesPdf = await readFile(join(folder1, "1.1 Slides Teste.pdf"));
      const slidesPdfText = slidesPdf.toString("latin1");

      expect(slidesPdfText.startsWith("%PDF-1.4")).toBe(true);
      expect(slidesPdfText).toContain("/Count 3");
      expect(slidesPdfText).toContain("%%EOF");

      const folder1Files = await readdir(folder1);

      expect(folder1Files.some((name) => name.endsWith(".mp4"))).toBe(false);

      const folder2Files = await readdir(folder2);

      expect(folder2Files).toEqual(["1.2 Revisao e Links.md"]);

      const md2 = await readFile(
        join(folder2, "1.2 Revisao e Links.md"),
        "utf8",
      );

      expect(md2).toContain(
        "— Já baixado como `1. Dia 1 / 1.1 Slides Teste.pdf`",
      );

      expect(md2).toContain(
        "— Já baixado como `1. Dia 1 / 1.1 Diagrama Teste.svg`",
      );

      expect(md2).toContain(
        "- PDF: `1. Dia 1 / 1.1 Apostila do Modulo.pdf` (já baixado)",
      );

      expect(md2).toContain(
        "- Imagem: `1. Dia 1 / 1.1 Fluxo Geral.png` (já baixado)",
      );
    } finally {
      await downloadPage.close();
    }
  } finally {
    await setupPage.close().catch(() => {});
    await server.close();
  }
});
