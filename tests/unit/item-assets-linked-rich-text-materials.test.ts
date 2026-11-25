import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTiptapEntityMap,
  canonicalDocumentUrlKey,
  countItemCompanionDocuments,
  emptyItemCompanionDocuments,
  extractItemCompanionDocumentsFromRichText,
  extractRichTextLinkedPostUrls,
  mergeItemCompanionDocuments,
  summarizeItemCompanionDocuments,
  type ItemCompanionDocuments,
} from "../../lib/item-assets.ts";

test("should resolve linked rich-text entities and merge companion documents", () => {
  const pageUrl =
    "https://training.example/c/sample-course/sections/10/lessons/20";

  const empty = emptyItemCompanionDocuments();

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
