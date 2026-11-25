import test from "node:test";
import assert from "node:assert/strict";
import { extractItemCompanionDocumentsFromRichText } from "../../lib/item-assets.ts";

test("should extract markdown, PDFs, images, diagrams, and slides from TipTap richTextBody", () => {
  const pageUrl = "https://training.example/c/eng/sections/s1/lessons/2-4";

  const richTextBody = {
    inline_attachments: [
      {
        signed_id: "sig-img-1",
        url: "https://assets.example/rails/active_storage/representations/redirect/sig-img-1/large/arch.png",
        filename: "arch.png",
        content_type: "image/png",
        image_variants: {
          original: "https://assets.example/originals/arch.png",
          large: "https://assets.example/large/arch.png",
          thumbnail: "https://assets.example/thumb/arch.png",
        },
      },
      {
        signed_id: "sig-pdf-1",
        url: "https://assets.example/abc123",
        filename: "architecture-guide.pdf",
        content_type: "application/pdf",
        image_variants: {
          thumbnail:
            "https://assets.example/rails/active_storage/representations/redirect/sig-pdf-1/thumb/architecture-guide.pdf",
        },
      },
      {
        signed_id: "sig-vid-ignored",
        url: "https://assets.example/clip.mp4",
        filename: "clip.mp4",
        content_type: "video/mp4",
      },
      "invalid-entry",
    ],
    attachments: [
      {
        signed_id: "sig-img-2",
        url: "/rails/active_storage/representations/redirect/sig-img-2/med/flow.webp",
        content_type: "image/webp",
      },
      {
        signed_id: "sig-img-variant-only",
        type: "image",
        name: "fallback-pic.jpg",
        image_variants: {
          medium:
            "https://assets.example/rails/active_storage/representations/redirect/sig-img-variant-only/med/fallback-pic.jpg",
        },
      },
      {
        signed_id: "sig-pdf-thumb-fallback",
        filename: "notes.pdf",
        image_variants: {
          thumbnail:
            "https://assets.example/rails/active_storage/representations/redirect/sig-pdf-thumb-fallback/var/notes.pdf",
        },
      },
      {
        signed_id: "sig-empty",
        content_type: "image/png",
      },
      {
        signed_id: "sig-empty-pdf",
        content_type: "application/pdf",
      },
    ],
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ver " },
            {
              type: "text",
              text: "Diagrama ",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://app.excalidraw.com/s/flow-1" },
                },
              ],
            },
            {
              type: "text",
              text: "Principal",
              marks: [
                { type: "bold" },
                {
                  type: "link",
                  attrs: { href: "https://app.excalidraw.com/s/flow-1" },
                },
              ],
            },
            { type: "text", text: ", " },
            {
              type: "text",
              text: "Slides",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://slides.example/deck.html" },
                },
              ],
            },
            { type: "text", text: " e " },
            {
              type: "text",
              text: "Resumo PDF",
              marks: [
                {
                  type: "link",
                  attrs: { href: "/files/summary.pdf" },
                },
              ],
            },
            { type: "text", text: " e " },
            {
              type: "text",
              text: "Dup Diagrama",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://app.excalidraw.com/s/flow-1" },
                },
              ],
            },
            { type: "text", text: " e " },
            {
              type: "text",
              text: "Video Link",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://youtube.com/watch?v=123" },
                },
              ],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            signed_id: "sig-img-1",
            src: "https://assets.example/originals/arch.png",
          },
        },
        {
          type: "image",
          attrs: {
            src: "https://cdn.example/inline-diagram.png",
            title: "inline-diagram.png",
          },
        },
        {
          type: "image",
          attrs: {
            url: "https://cdn.example/inline-diagram.png",
          },
        },
        {
          type: "image",
          attrs: {
            src: "javascript:alert(1)",
          },
        },
        {
          type: "image",
        },
      ],
    },
  };

  const result = extractItemCompanionDocumentsFromRichText(richTextBody, {
    title: "2.4 Feature Design",
    pageUrl,
  });

  assert.match(result.markdown, /^# 2\.4 Feature Design\n\nVer /);
  assert.equal(result.images.length, 4);

  assert.deepEqual(result.images[0], {
    kind: "image",
    url: "https://assets.example/originals/arch.png",
    fallbackUrl:
      "https://assets.example/rails/active_storage/representations/redirect/sig-img-1/large/arch.png",
    filename: "arch.png",
    contentType: "image/png",
  });

  assert.deepEqual(result.images[1], {
    kind: "image",
    url: "https://training.example/rails/active_storage/representations/redirect/sig-img-2/med/flow.webp",
    fallbackUrl:
      "https://training.example/rails/active_storage/blobs/redirect/sig-img-2/flow.webp",
    filename: "flow.webp",
    contentType: "image/webp",
  });

  assert.equal(
    result.images[2].url,
    "https://assets.example/rails/active_storage/blobs/redirect/sig-img-variant-only/fallback-pic.jpg",
  );

  assert.equal(result.images[3].url, "https://cdn.example/inline-diagram.png");

  assert.equal(result.pdfs.length, 3);

  assert.deepEqual(result.pdfs[0], {
    kind: "pdf",
    url: "https://assets.example/abc123",
    fallbackUrl:
      "https://assets.example/rails/active_storage/blobs/redirect/sig-pdf-1/architecture-guide.pdf",
    filename: "architecture-guide.pdf",
    contentType: "application/pdf",
  });

  assert.equal(
    result.pdfs[1].url,
    "https://assets.example/rails/active_storage/blobs/redirect/sig-pdf-thumb-fallback/notes.pdf",
  );

  assert.equal(
    result.pdfs[2].url,
    "https://training.example/files/summary.pdf",
  );

  assert.deepEqual(result.diagrams, [
    {
      kind: "diagram",
      url: "https://app.excalidraw.com/s/flow-1",
      title: "Diagrama Principal",
    },
  ]);

  assert.deepEqual(result.slides, [
    {
      kind: "slides",
      url: "https://slides.example/deck.html",
      title: "Slides",
    },
  ]);
});
