import test from "node:test";
import assert from "node:assert/strict";
import { extractItemCompanionDocumentsFromRichText } from "./item-assets.ts";

test("should return empty markdown for blank richTextBody even when title is provided, and accept bare doc", () => {
  assert.deepEqual(
    extractItemCompanionDocumentsFromRichText(null, {
      title: "1.1 Blank",
      pageUrl: "https://training.example/lesson",
    }),
    {
      markdown: "",
      images: [],
      pdfs: [],
      diagrams: [],
      slides: [],
    },
  );

  const imageOnly = extractItemCompanionDocumentsFromRichText(
    {
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "   " }] },
          {
            type: "image",
            attrs: { src: "https://cdn.example/only-image.png" },
          },
        ],
      },
    },
    { title: "1.2 Video Only", pageUrl: "https://training.example/lesson" },
  );

  assert.equal(imageOnly.markdown, "");
  assert.equal(imageOnly.images.length, 1);

  const bareDoc = extractItemCompanionDocumentsFromRichText(
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Notes" }] },
      ],
    },
    { title: "1.3 Bare", pageUrl: "https://training.example/lesson" },
  );

  assert.equal(bareDoc.markdown, "# 1.3 Bare\n\nNotes\n");

  const singleBlockDoc = extractItemCompanionDocumentsFromRichText(
    {
      body: {
        type: "paragraph",
        content: [{ type: "text", text: "Single" }],
      },
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(singleBlockDoc.markdown, "Single\n");

  const edgeRichText = extractItemCompanionDocumentsFromRichText(
    {
      inline_attachments: [
        {
          signedId: "camel-1",
          url: "https://assets.example/pic.jpg",
        },
        {
          url: "https://assets.example/download-pdf/",
          contentType: "application/pdf",
        },
      ],
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "One",
                marks: [
                  {
                    type: "link",
                    attrs: { url: "https://app.excalidraw.com/s/1" },
                  },
                ],
              },
              {
                type: "text",
                text: "Two",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://slides.example/?slide=2" },
                  },
                ],
              },
              {
                type: "text",
                text: "Bad",
                marks: [{ type: "link", attrs: { href: "javascript:bad" } }],
              },
            ],
          },
          {
            type: "image",
            attrs: {
              signedId: "camel-1",
              src: "https://assets.example/pic.jpg",
            },
          },
          {
            type: "image",
            attrs: {
              src: "https://assets.example/rails/active_storage/representations/redirect/body1/var/shot.png",
              filename: "folder/shot.png",
            },
          },
        ],
      },
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(edgeRichText.images.length, 2);

  assert.equal(
    edgeRichText.images[1].fallbackUrl,
    "https://assets.example/rails/active_storage/blobs/redirect/body1/shot.png",
  );

  assert.equal(edgeRichText.pdfs[0].filename, "download-pdf");

  const noBodyAttachmentOnly = extractItemCompanionDocumentsFromRichText(
    {
      attachments: [
        { url: "https://assets.example/", content_type: "application/pdf" },
      ],
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(noBodyAttachmentOnly.pdfs[0].filename, "document.pdf");

  const leafBodyDoc = extractItemCompanionDocumentsFromRichText(
    {
      body: {
        type: "image",
        attrs: { src: "https://cdn.example/leaf.png" },
      },
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(leafBodyDoc.images[0].url, "https://cdn.example/leaf.png");

  const nonObjectBody = extractItemCompanionDocumentsFromRichText(
    { body: "invalid" },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(nonObjectBody.markdown, "");
});
