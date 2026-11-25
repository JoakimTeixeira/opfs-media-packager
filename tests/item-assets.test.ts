import test from "node:test";
import assert from "node:assert/strict";
import {
  activeStorageBlobUrl,
  buildTiptapEntityMap,
  canonicalDocumentUrlKey,
  countItemCompanionDocuments,
  emptyItemCompanionDocuments,
  extractFeaturedMediaEmbed,
  extractItemCompanionDocumentsFromLinksAndHtml,
  extractItemCompanionDocumentsFromRichText,
  extractRichTextLinkedPostUrls,
  isExcalidrawUrl,
  isItemDownloadableForMode,
  isSlidesDeckUrl,
  itemNumberPrefix,
  mergeItemCompanionDocuments,
  normalizeEmbeddedVideoUrl,
  prefixedDocumentFilename,
  summarizeItemCompanionDocuments,
  withEmbeddedVideoMarkdown,
  type ItemFileAsset,
  type ItemLinkAsset,
  type ItemCompanionDocuments,
} from "../lib/item-assets.ts";

test("should rewrite ActiveStorage representation URLs to original blob URLs and reject others", () => {
  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/rails/active_storage/representations/redirect/signed123/var456/diagram.png",
    ),
    "https://assets.example/rails/active_storage/blobs/redirect/signed123/diagram.png",
  );

  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/app/rails/active_storage/representations/proxy/signed123/var456/photo.webp",
    ),
    "https://assets.example/app/rails/active_storage/blobs/proxy/signed123/photo.webp",
  );

  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/rails/active_storage/representations/signed123/var456/legacy.jpg",
    ),
    "https://assets.example/rails/active_storage/blobs/redirect/signed123/legacy.jpg",
  );

  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/rails/active_storage/blobs/proxy/signed123/photo.png",
    ),
    null,
  );

  assert.equal(
    activeStorageBlobUrl("https://cdn.example/images/photo.png"),
    null,
  );

  assert.equal(
    activeStorageBlobUrl(
      "http://localhost/rails/active_storage/representations/redirect/a/b/c.png",
    ),
    null,
  );
});

test("should identify valid Excalidraw URLs across allowed subdomains", () => {
  assert.equal(isExcalidrawUrl("https://app.excalidraw.com/s/123"), true);
  assert.equal(isExcalidrawUrl("https://app.excalidraw.com/l/abc"), true);
  assert.equal(isExcalidrawUrl("https://link.excalidraw.com/l/xyz"), true);
  assert.equal(isExcalidrawUrl("https://excalidraw.com/#json=1,key"), true);
  assert.equal(isExcalidrawUrl("http://excalidraw.com/#room=1"), true);

  assert.equal(isExcalidrawUrl("https://notexcalidraw.com/s/123"), false);

  assert.equal(
    isExcalidrawUrl("https://training.example/excalidraw.com"),
    false,
  );

  assert.equal(isExcalidrawUrl("javascript:excalidraw.com"), false);
  assert.equal(isExcalidrawUrl("http://127.0.0.1/excalidraw.com"), false);
});

test("should detect interactive slide deck URLs while filtering repos, videos, courses, and static files", () => {
  assert.equal(
    isSlidesDeckUrl("https://slides.example/architecture?slide=9"),
    true,
  );

  assert.equal(isSlidesDeckUrl("https://slides.example/?slide=0"), true);

  assert.equal(
    isSlidesDeckUrl("https://slides.example/", "Slides da aula"),
    true,
  );

  assert.equal(
    isSlidesDeckUrl("https://slides.example/deck.html", "Apresentação"),
    true,
  );

  assert.equal(
    isSlidesDeckUrl("https://slides.example/module/slides/1", "Main Deck"),
    true,
  );

  assert.equal(
    isSlidesDeckUrl("https://slides.example/blog/article", "Slides notes"),
    false,
  );

  assert.equal(isSlidesDeckUrl("https://slides.example/?slide=intro"), false);

  assert.equal(
    isSlidesDeckUrl("http://slides.example/?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://app.excalidraw.com/?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://cdn.example/deck.pdf?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://cdn.example/slide.png?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl(
      "https://training.example/c/eng/sections/s1/lessons/l1?slide=1",
      "Slides",
    ),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://training.example/courses/abc?slide=1", "Slides"),
    false,
  );

  for (const excludedHost of [
    "github.com",
    "gist.github.com",
    "youtube.com",
    "youtu.be",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "amazon.com",
    "npmjs.com",
  ]) {
    assert.equal(
      isSlidesDeckUrl(`https://${excludedHost}/talk?slide=2`, "Slides"),
      false,
    );
  }

  assert.equal(isSlidesDeckUrl("not-a-url", "Slides"), false);
});

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

test("should extract lesson number prefix and format Windows-safe prefixed material filenames", () => {
  assert.equal(
    itemNumberPrefix("2.4 Transformando contexto em Feature"),
    "2.4 ",
  );

  assert.equal(itemNumberPrefix("1.1 Intro"), "1.1 ");
  assert.equal(itemNumberPrefix("  10.2.3 Deep"), "10.2.3 ");
  assert.equal(itemNumberPrefix("Introduction"), "");
  assert.equal(itemNumberPrefix("2.4"), "");

  assert.equal(
    prefixedDocumentFilename(
      "2.4 Transformando contexto em Feature",
      "Diagramas mostrados na aula",
      "svg",
    ),
    "2.4 Diagramas mostrados na aula.svg",
  );

  assert.equal(
    prefixedDocumentFilename(
      "2.4 Transformando contexto em Feature",
      "2.4 Transformando contexto em Feature",
      "md",
    ),
    "2.4 Transformando contexto em Feature.md",
  );

  assert.equal(
    prefixedDocumentFilename("1.1 Intro", "handout.PDF", ".pdf"),
    "1.1 handout.pdf",
  );

  assert.equal(
    prefixedDocumentFilename("1.1 Intro", "🔴|:", "png", "diagram"),
    "1.1 diagram.png",
  );

  assert.equal(
    prefixedDocumentFilename("1.1 Intro", "video.mp4", "mp4", "fallback"),
    "1.1 video.mp4",
  );

  assert.equal(prefixedDocumentFilename("No Number", "", ""), "document.bin");

  const bounded = prefixedDocumentFilename("2.4 Item", "a".repeat(140), "png");

  assert.equal(bounded.endsWith(".png"), true);
  assert.equal(bounded.length <= 120, true);

  assert.equal(
    prefixedDocumentFilename("2.4 Item", "🔴", "png", "..."),
    "2.4 document.png",
  );

  assert.equal(prefixedDocumentFilename("2.4 Item", "2.4 - ", "md"), "2.4.md");
});

test("should count and summarize lesson materials accurately", () => {
  assert.equal(countItemCompanionDocuments(null), 0);
  assert.equal(countItemCompanionDocuments(undefined), 0);
  assert.deepEqual(summarizeItemCompanionDocuments(null), []);
  assert.deepEqual(summarizeItemCompanionDocuments(undefined), []);

  const empty: ItemCompanionDocuments = {
    markdown: "",
    images: [],
    pdfs: [],
    diagrams: [],
    slides: [],
  };

  assert.equal(countItemCompanionDocuments(empty), 0);
  assert.deepEqual(summarizeItemCompanionDocuments(empty), []);

  const img1: ItemFileAsset = {
    kind: "image",
    url: "https://cdn.example/1.png",
    filename: "1.png",
  };

  const pdf1: ItemFileAsset = {
    kind: "pdf",
    url: "https://cdn.example/1.pdf",
    filename: "1.pdf",
  };

  const diag1: ItemLinkAsset = {
    kind: "diagram",
    url: "https://excalidraw.com/#1",
    title: "D1",
  };

  const slide1: ItemLinkAsset = {
    kind: "slides",
    url: "https://slides.example/?slide=1",
    title: "S1",
  };

  const single: ItemCompanionDocuments = {
    markdown: "# Lesson\n",
    images: [img1],
    pdfs: [pdf1],
    diagrams: [diag1],
    slides: [slide1],
  };

  assert.equal(countItemCompanionDocuments(single), 5);

  assert.deepEqual(summarizeItemCompanionDocuments(single), [
    "MD",
    "1 PDF",
    "1 image",
    "1 diagram",
    "1 slides",
  ]);

  const plural: ItemCompanionDocuments = {
    markdown: "",
    images: [
      img1,
      { kind: "image", url: "https://cdn.example/2.png", filename: "2.png" },
    ],
    pdfs: [
      pdf1,
      { kind: "pdf", url: "https://cdn.example/2.pdf", filename: "2.pdf" },
    ],
    diagrams: [
      diag1,
      { kind: "diagram", url: "https://excalidraw.com/#2", title: "D2" },
    ],
    slides: [
      slide1,
      { kind: "slides", url: "https://slides.example/?slide=2", title: "S2" },
    ],
  };

  assert.equal(countItemCompanionDocuments(plural), 8);

  assert.deepEqual(summarizeItemCompanionDocuments(plural), [
    "2 PDFs",
    "2 images",
    "2 diagrams",
    "2 slides",
  ]);
});

test("should normalize canonical material URL keys across images, PDFs, diagrams, and slides", () => {
  assert.equal(
    canonicalDocumentUrlKey("  javascript:bad  ", "pdf"),
    "javascript:bad",
  );

  const imgRepr =
    "https://assets.example/rails/active_storage/representations/redirect/sig1/var2/arch.png#view";

  const imgBlob =
    "https://assets.example/rails/active_storage/blobs/redirect/sig1/arch.png/";

  assert.equal(
    canonicalDocumentUrlKey(imgRepr, "image"),
    canonicalDocumentUrlKey(imgBlob, "image"),
  );

  assert.equal(
    canonicalDocumentUrlKey("https://assets.example/", "pdf"),
    "https://assets.example/",
  );

  assert.equal(
    canonicalDocumentUrlKey(
      "https://SLIDES.example/deck/?slide=9#top",
      "slides",
    ),
    "https://slides.example/deck",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://slides.example/deck?slide=2", "slides"),
    "https://slides.example/deck",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://slides.example/?slide=intro#a", "slides"),
    "https://slides.example/?slide=intro",
  );

  assert.equal(
    canonicalDocumentUrlKey(
      "https://APP.EXCALIDRAW.COM/l/room/scene/#",
      "diagram",
    ),
    "https://app.excalidraw.com/l/room/scene",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://excalidraw.com/#json=123,abc", "diagram"),
    "https://excalidraw.com/#json=123,abc",
  );
});

test("should evaluate lesson eligibility per download mode across video, subtitle, and material subsets", () => {
  const sampleMaterials: ItemCompanionDocuments = {
    markdown: "# Notes\n",
    images: [],
    pdfs: [],
    diagrams: [],
    slides: [],
  };

  const emptyLesson = { url: "", qualityOptions: [], subtitles: [] };
  const videoOnly = { url: "https://media.example/master.m3u8" };
  const qualityOnly = { url: "", qualityOptions: [{ label: "720p" }] };

  const subtitleOnly = {
    url: "",
    subtitles: [
      { url: "https://media.example/pt.vtt", language: "Portuguese" },
    ],
  };

  const documentsOnly = { url: "", documents: sampleMaterials };

  const combined = {
    url: "https://media.example/master.m3u8",
    subtitles: [{ url: "https://media.example/pt.vtt" }],
    documents: sampleMaterials,
  };

  for (const mode of ["all", "videos", "documents"] as const) {
    assert.equal(isItemDownloadableForMode(emptyLesson, mode), false);
    assert.equal(isItemDownloadableForMode(combined, mode), true);
  }

  assert.equal(isItemDownloadableForMode(videoOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(videoOnly, "videos"), true);
  assert.equal(isItemDownloadableForMode(videoOnly, "documents"), false);

  assert.equal(isItemDownloadableForMode(qualityOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(qualityOnly, "videos"), true);
  assert.equal(isItemDownloadableForMode(qualityOnly, "documents"), false);

  assert.equal(isItemDownloadableForMode(subtitleOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(subtitleOnly, "videos"), true);
  assert.equal(isItemDownloadableForMode(subtitleOnly, "documents"), false);

  assert.equal(isItemDownloadableForMode(documentsOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(documentsOnly, "videos"), false);
  assert.equal(isItemDownloadableForMode(documentsOnly, "documents"), true);
});

test("should extract embedded YouTube videos, resolve entity maps, extract non-related linked post URLs, and merge materials/extraNotes", () => {
  const pageUrl =
    "https://training.example/c/sample-course/sections/10/lessons/20";

  assert.equal(
    normalizeEmbeddedVideoUrl(
      "https://www.youtube-nocookie.com/embed/vid11111111?rel=0",
      pageUrl,
    ),
    "https://www.youtube.com/watch?v=vid11111111",
  );

  assert.equal(
    normalizeEmbeddedVideoUrl("https://player.vimeo.com/video/123", pageUrl),
    "https://player.vimeo.com/video/123",
  );

  assert.equal(normalizeEmbeddedVideoUrl("javascript:alert(1)", pageUrl), null);

  assert.equal(extractFeaturedMediaEmbed(null, pageUrl), null);
  assert.equal(extractFeaturedMediaEmbed({}, pageUrl), null);

  assert.deepEqual(
    extractFeaturedMediaEmbed(
      {
        lesson: {
          featured_media_embed: {
            title: "Sample Workshop",
            html: '<iframe src="https://www.youtube.com/embed/vid11111111?rel=0"></iframe>',
          },
        },
      },
      pageUrl,
    ),
    {
      url: "https://www.youtube.com/watch?v=vid11111111",
      title: "Sample Workshop",
    },
  );

  assert.deepEqual(
    extractFeaturedMediaEmbed(
      {
        post: {
          featured_media_embed: {
            content: "https://youtu.be/vid22222222",
            title: "Streaming Demo",
          },
        },
      },
      pageUrl,
    ),
    {
      url: "https://youtu.be/vid22222222",
      title: "Streaming Demo",
    },
  );

  const empty = emptyItemCompanionDocuments();

  assert.equal(
    withEmbeddedVideoMarkdown(empty, null, "1.5 Intro").markdown,
    "",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      empty,
      { url: "https://www.youtube.com/watch?v=vid11111111" },
      "1.5 Intro",
    ).markdown,
    "# 1.5 Intro\n\n**Vídeo:** [https://www.youtube.com/watch?v=vid11111111](https://www.youtube.com/watch?v=vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      empty,
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
      "",
    ).markdown,
    "**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "# Title\n\nBody text.\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
    ).markdown,
    "# Title\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n\nBody text.\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "# Heading Only\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
    ).markdown,
    "# Heading Only\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Plain body.\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
      "1.5 Fallback",
    ).markdown,
    "# 1.5 Fallback\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n\nPlain body.\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Already [here](https://youtu.be/vid11111111)\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
    ).markdown,
    "Already [here](https://youtu.be/vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      {
        ...empty,
        markdown:
          "Already [here](https://www.youtube.com/watch?v=vid22222222)\n",
      },
      { url: "https://youtu.be/vid22222222", title: "Talk" },
    ).markdown,
    "Already [here](https://www.youtube.com/watch?v=vid22222222)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Embed [here](https://youtu.be/vid22222222)\n" },
      { url: "https://www.youtube.com/embed/vid22222222", title: "Talk" },
    ).markdown,
    "Embed [here](https://youtu.be/vid22222222)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Other [v](https://vimeo.com/123)\n" },
      { url: "https://vimeo.com/123", title: "Vimeo" },
    ).markdown,
    "Other [v](https://vimeo.com/123)\n",
  );

  const complexRichText = {
    sgids_to_object_map: {
      "sgid-post-1": {
        name: "Post Video 1",
        url: "https://training.example/c/comunidade/post-1",
      },
      "sgid-embed-post": {
        type: "embed",
        title: "Preview Session",
        url: "https://training.example/c/events/preview-session",
      },
      "sgid-embed-diag": {
        type: "embed",
        title: "Embed Diagram",
        url: "https://app.excalidraw.com/l/room/embed-1",
      },
      "sgid-diag": {
        name: "Diagrama Excalidraw",
        url: "https://app.excalidraw.com/l/room/1",
      },
      "sgid-related": {
        name: "Relacionado",
        url: "https://training.example/c/comunidade/relacionado",
      },
    },
    entities: [
      {
        sgid: "sgid-post-1",
        name: "Duplicate Ignored",
        url: "https://training.example/c/comunidade/other",
      },
      {
        sgid: "sgid-post-2",
        title: "Post Video 2",
        url: "/c/comunidade/post-2",
      },
      {
        sgid: "sgid-invalid",
        name: "Invalid",
        url: "javascript:bad",
      },
    ],
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "entity", attrs: { sgid: "sgid-post-1" } },
            { type: "text", text: " " },
            { type: "entity", attrs: { sgid: "sgid-diag" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "entity", attrs: { sgid: "sgid-post-2" } },
            {
              type: "text",
              text: " yt ",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://www.youtube.com/watch?v=abc12345" },
                },
              ],
            },
          ],
        },
        {
          type: "embed",
          attrs: { sgid: "sgid-embed-post" },
        },
        {
          type: "embed",
          attrs: { sgid: "sgid-embed-diag" },
        },
        {
          type: "embed",
          attrs: {
            src: "https://slides.example/deck?slide=1",
            title: "Slides Deck",
          },
        },
        {
          type: "embed",
          attrs: {},
        },
        {
          type: "cta",
          attrs: {
            label: "Post 3 CTA",
            url: "https://training.example/c/comunidade/post-3",
          },
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "text", text: "Conteúdos relacionados na plataforma" },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Subseção" }],
        },
        {
          type: "paragraph",
          content: [{ type: "entity", attrs: { sgid: "sgid-related" } }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Outro bloco" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Conteúdos relacionados",
              marks: [{ type: "bold" }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Skip list link",
                      marks: [
                        {
                          type: "link",
                          attrs: {
                            href: "https://training.example/c/comunidade/skip-list",
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Texto normal retomado." }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Final post",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://training.example/c/comunidade/post-final",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  assert.equal(buildTiptapEntityMap(complexRichText, pageUrl).size, 6);
  assert.deepEqual(extractRichTextLinkedPostUrls(null, pageUrl), []);

  assert.deepEqual(extractRichTextLinkedPostUrls(complexRichText, pageUrl), [
    "https://training.example/c/comunidade/post-1",
    "https://training.example/c/comunidade/post-2",
    "https://training.example/c/events/preview-session",
    "https://training.example/c/comunidade/post-3",
    "https://training.example/c/comunidade/post-final",
  ]);

  const extracted = extractItemCompanionDocumentsFromRichText(complexRichText, {
    title: "3.10 Pattern Overview",
    pageUrl,
    embeddedVideo: null,
  });

  assert.equal(extracted.diagrams.length, 2);
  assert.equal(extracted.slides.length, 1);

  assert.ok(
    extracted.markdown.includes(
      "[Preview Session](https://training.example/c/events/preview-session)",
    ),
  );

  assert.ok(
    extracted.markdown.includes(
      "[Post Video 1](https://training.example/c/comunidade/post-1)",
    ),
  );

  const nullEmbedded = extractItemCompanionDocumentsFromRichText(null, {
    title: "2.1 YouTube Only",
    pageUrl,
    embeddedVideo: {
      url: "https://www.youtube.com/watch?v=vid22222222",
      title: "Streaming Demo",
    },
  });

  assert.match(nullEmbedded.markdown, /^# 2\.1 YouTube Only\n\n\*\*Vídeo:\*\*/);

  assert.equal(mergeItemCompanionDocuments(null, null), undefined);
  assert.equal(mergeItemCompanionDocuments(empty, null), undefined);
  assert.equal(mergeItemCompanionDocuments(extracted, null), extracted);

  const postNoteMaterials: ItemCompanionDocuments = {
    markdown: "# Post 1\n\nRepo [link](https://github.com/org/repo)\n",
    images: [
      {
        kind: "image",
        url: "https://assets.example/rails/active_storage/blobs/redirect/sig1/pic.png",
        filename: "pic.png",
      },
    ],
    pdfs: [],
    diagrams: [
      {
        kind: "diagram",
        url: "https://app.excalidraw.com/l/room/1",
        title: "Dup diagram",
      },
      {
        kind: "diagram",
        url: "https://app.excalidraw.com/l/room/2",
        title: "New diagram",
      },
    ],
    slides: [],
    extraNotes: [
      { title: "Blank skipped", markdown: "   " },
      { title: "No url note", markdown: "# Extra body\n" },
      { title: "No url note", markdown: "# Extra body\n" },
    ],
  };

  const mergedWithNote = mergeItemCompanionDocuments(
    extracted,
    postNoteMaterials,
    {
      secondaryAsExtraNote: {
        title: "Post Video 1",
        sourceUrl: "https://training.example/c/comunidade/post-1",
      },
    },
  );

  assert.ok(mergedWithNote);
  assert.equal(mergedWithNote.diagrams.length, 3);
  assert.equal(mergedWithNote.extraNotes?.length, 2);
  assert.equal(mergedWithNote.markdown, extracted.markdown);

  const mergedFromNullPrimary = mergeItemCompanionDocuments(
    null,
    postNoteMaterials,
  );

  assert.equal(mergedFromNullPrimary?.markdown, postNoteMaterials.markdown);
  assert.equal(mergeItemCompanionDocuments(empty, { ...empty }), undefined);

  const notesOnly: ItemCompanionDocuments = {
    ...empty,
    extraNotes: [{ title: "Post Note", markdown: "# Post Note\n" }],
  };

  assert.equal(countItemCompanionDocuments(notesOnly), 1);
  assert.deepEqual(summarizeItemCompanionDocuments(notesOnly), ["MD"]);

  assert.equal(
    canonicalDocumentUrlKey("https://training.example/c/p/#frag", "note"),
    "https://training.example/c/p",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://training.example/c/p/", "video"),
    "https://training.example/c/p",
  );
});
