import { test } from "vitest";
import assert from "node:assert/strict";
import { extractItemCompanionDocumentsFromLinksAndHtml } from "./item-assets.ts";

test("should extract materials from DOM fallback HTML, images, and links", () => {
  const pageUrl = "https://training.example/c/eng/sections/s1/lessons/3";

  const materials = extractItemCompanionDocumentsFromLinksAndHtml({
    title: "1.3 Fallback",
    pageUrl,
    html: "<p>Veja o diagrama e os slides.</p>",
    images: [
      {
        url: "https://assets.example/rails/active_storage/representations/redirect/img1/var/board.png",
      },
      {
        url: "https://assets.example/rails/active_storage/blobs/redirect/img1/board.png",
      },
      {
        url: "https://cdn.example/photo.jpg",
        filename: "custom-photo.jpg",
      },
      {
        url: "javascript:alert(1)",
      },
    ],
    links: [
      {
        url: "/rails/active_storage/representations/redirect/pdf1/var/guide.pdf",
        text: "Guia",
      },
      {
        url: "/rails/active_storage/representations/redirect/pdf1/var/guide.pdf",
        text: "Dup Guia",
      },
      { url: "https://link.excalidraw.com/l/board-1", text: "" },
      { url: "https://slides.example/?slide=4", text: "" },
      { url: "https://slides.example/?slide=4", text: "Duplicate" },
      { url: "https://cdn.example/%ZZ.png", text: "Malformed encoding" },
      { url: "https://cdn.example/%2F", text: "Slash encoding" },
      { url: "//evil.example/skip", text: "Ignored" },
    ],
  });

  assert.equal(
    materials.markdown,
    "# 1.3 Fallback\n\nVeja o diagrama e os slides.\n",
  );

  assert.equal(materials.images.length, 2);

  assert.deepEqual(materials.images[0], {
    kind: "image",
    url: "https://assets.example/rails/active_storage/blobs/redirect/img1/board.png",
    fallbackUrl:
      "https://assets.example/rails/active_storage/representations/redirect/img1/var/board.png",
    filename: "board.png",
  });

  assert.equal(materials.images[1].filename, "custom-photo.jpg");

  assert.deepEqual(materials.pdfs, [
    {
      kind: "pdf",
      url: "https://training.example/rails/active_storage/representations/redirect/pdf1/var/guide.pdf",
      fallbackUrl:
        "https://training.example/rails/active_storage/blobs/redirect/pdf1/guide.pdf",
      filename: "guide.pdf",
    },
  ]);

  assert.deepEqual(materials.diagrams, [
    {
      kind: "diagram",
      url: "https://link.excalidraw.com/l/board-1",
      title: "Excalidraw diagram",
    },
  ]);

  assert.deepEqual(materials.slides, [
    {
      kind: "slides",
      url: "https://slides.example/?slide=4",
      title: "Slides",
    },
  ]);

  const noListsFallback = extractItemCompanionDocumentsFromLinksAndHtml({
    pageUrl,
    html: "<p>Only text</p>",
  });

  assert.equal(noListsFallback.markdown, "Only text\n");

  const weirdFilenamesFallback = extractItemCompanionDocumentsFromLinksAndHtml({
    pageUrl,
    html: "<p>Weird names</p>",
    images: [
      { url: "https://cdn.example/" },
      { url: "https://cdn.example/%ZZ.png" },
      { url: "https://cdn.example/%2F" },
    ],
  });

  assert.equal(weirdFilenamesFallback.images[0].filename, "image.png");
  assert.equal(weirdFilenamesFallback.images[1].filename, "%ZZ.png");
  assert.equal(weirdFilenamesFallback.images[2].filename, "image.png");

  const blankFallback = extractItemCompanionDocumentsFromLinksAndHtml({
    title: "1.4 Blank",
    pageUrl: "not-a-valid-page-url",
    html: "<div>   </div>",
    images: [{ url: "/relative.png" }],
    links: [{ url: "/relative.pdf" }],
  });

  assert.equal(blankFallback.markdown, "");
  assert.equal(blankFallback.images.length, 0);
  assert.equal(blankFallback.pdfs.length, 0);
});
