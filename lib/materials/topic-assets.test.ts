import { test } from "vitest";
import assert from "node:assert/strict";
import {
  extractTopicCompanionDocumentsFromRichText,
  extractTopicCompanionDocumentsFromLinksAndHtml,
  buildTiptapEntityMap,
  canonicalDocumentUrlKey,
  countTopicCompanionDocuments,
  emptyTopicCompanionDocuments,
  extractRichTextLinkedPostUrls,
  mergeTopicCompanionDocuments,
  summarizeTopicCompanionDocuments,
  type TopicCompanionDocuments,
} from "./topic-assets.ts";
import { richTextBody } from "./__fixtures__/rich-text-body.ts";
import { edgeRichTextInput } from "./__fixtures__/edge-rich-text.ts";
import { domMaterialsInput } from "./__fixtures__/dom-materials.ts";
import { complexRichText } from "./__fixtures__/complex-rich-text.ts";
import { postNoteMaterials } from "./__fixtures__/post-note-materials.ts";

test("should extract markdown, PDFs, images, diagrams, and slides from TipTap richTextBody", () => {
  const pageUrl = "https://training.example/c/eng/sections/s1/lessons/2-4";

  const result = extractTopicCompanionDocumentsFromRichText(richTextBody, {
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
    extractTopicCompanionDocumentsFromRichText(null, {
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

  const imageOnly = extractTopicCompanionDocumentsFromRichText(
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

  const bareDoc = extractTopicCompanionDocumentsFromRichText(
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Notes" }] },
      ],
    },
    { title: "1.3 Bare", pageUrl: "https://training.example/lesson" },
  );

  assert.equal(bareDoc.markdown, "# 1.3 Bare\n\nNotes\n");

  const singleBlockDoc = extractTopicCompanionDocumentsFromRichText(
    {
      body: {
        type: "paragraph",
        content: [{ type: "text", text: "Single" }],
      },
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(singleBlockDoc.markdown, "Single\n");

  const edgeRichText = extractTopicCompanionDocumentsFromRichText(
    edgeRichTextInput,
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(edgeRichText.images.length, 2);

  assert.equal(
    edgeRichText.images[1].fallbackUrl,
    "https://assets.example/rails/active_storage/blobs/redirect/body1/shot.png",
  );

  assert.equal(edgeRichText.pdfs[0].filename, "download-pdf");

  const noBodyAttachmentOnly = extractTopicCompanionDocumentsFromRichText(
    {
      attachments: [
        { url: "https://assets.example/", content_type: "application/pdf" },
      ],
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(noBodyAttachmentOnly.pdfs[0].filename, "document.pdf");

  const leafBodyDoc = extractTopicCompanionDocumentsFromRichText(
    {
      body: {
        type: "image",
        attrs: { src: "https://cdn.example/leaf.png" },
      },
    },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(leafBodyDoc.images[0].url, "https://cdn.example/leaf.png");

  const nonObjectBody = extractTopicCompanionDocumentsFromRichText(
    { body: "invalid" },
    { pageUrl: "https://training.example/lesson" },
  );

  assert.equal(nonObjectBody.markdown, "");
});

test("should extract materials from DOM fallback HTML, images, and links", () => {
  const pageUrl = "https://training.example/c/eng/sections/s1/lessons/3";

  const materials = extractTopicCompanionDocumentsFromLinksAndHtml(
    domMaterialsInput(pageUrl),
  );

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

  const noListsFallback = extractTopicCompanionDocumentsFromLinksAndHtml({
    pageUrl,
    html: "<p>Only text</p>",
  });

  assert.equal(noListsFallback.markdown, "Only text\n");

  const weirdFilenamesFallback = extractTopicCompanionDocumentsFromLinksAndHtml(
    {
      pageUrl,
      html: "<p>Weird names</p>",
      images: [
        { url: "https://cdn.example/" },
        { url: "https://cdn.example/%ZZ.png" },
        { url: "https://cdn.example/%2F" },
      ],
    },
  );

  assert.equal(weirdFilenamesFallback.images[0].filename, "image.png");
  assert.equal(weirdFilenamesFallback.images[1].filename, "%ZZ.png");
  assert.equal(weirdFilenamesFallback.images[2].filename, "image.png");

  const blankFallback = extractTopicCompanionDocumentsFromLinksAndHtml({
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

test("should resolve linked rich-text entities and merge companion documents", () => {
  const pageUrl =
    "https://training.example/c/sample-course/sections/10/lessons/20";

  const empty = emptyTopicCompanionDocuments();

  assert.equal(buildTiptapEntityMap(complexRichText, pageUrl).size, 6);
  assert.deepEqual(extractRichTextLinkedPostUrls(null, pageUrl), []);

  assert.deepEqual(extractRichTextLinkedPostUrls(complexRichText, pageUrl), [
    "https://training.example/c/comunidade/post-1",
    "https://training.example/c/comunidade/post-2",
    "https://training.example/c/events/preview-session",
    "https://training.example/c/comunidade/post-3",
    "https://training.example/c/comunidade/post-final",
  ]);

  const extracted = extractTopicCompanionDocumentsFromRichText(
    complexRichText,
    {
      title: "3.10 Pattern Overview",
      pageUrl,
      embeddedVideo: null,
    },
  );

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

  const nullEmbedded = extractTopicCompanionDocumentsFromRichText(null, {
    title: "2.1 YouTube Only",
    pageUrl,
    embeddedVideo: {
      url: "https://www.youtube.com/watch?v=vid22222222",
      title: "Streaming Demo",
    },
  });

  assert.match(nullEmbedded.markdown, /^# 2\.1 YouTube Only\n\n\*\*Vídeo:\*\*/);

  assert.equal(mergeTopicCompanionDocuments(null, null), undefined);
  assert.equal(mergeTopicCompanionDocuments(empty, null), undefined);
  assert.equal(mergeTopicCompanionDocuments(extracted, null), extracted);

  const mergedWithNote = mergeTopicCompanionDocuments(
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

  const mergedFromNullPrimary = mergeTopicCompanionDocuments(
    null,
    postNoteMaterials,
  );

  assert.equal(mergedFromNullPrimary?.markdown, postNoteMaterials.markdown);
  assert.equal(mergeTopicCompanionDocuments(empty, { ...empty }), undefined);

  const notesOnly: TopicCompanionDocuments = {
    ...empty,
    extraNotes: [{ title: "Post Note", markdown: "# Post Note\n" }],
  };

  assert.equal(countTopicCompanionDocuments(notesOnly), 1);
  assert.deepEqual(summarizeTopicCompanionDocuments(notesOnly), ["MD"]);

  assert.equal(
    canonicalDocumentUrlKey("https://training.example/c/p/#frag", "note"),
    "https://training.example/c/p",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://training.example/c/p/", "video"),
    "https://training.example/c/p",
  );
});
