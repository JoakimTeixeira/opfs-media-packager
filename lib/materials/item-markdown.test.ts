import { test } from "vitest";
import assert from "node:assert/strict";
import { tiptapJsonToMarkdown, type TiptapNode } from "./item-markdown.ts";

test("should return empty string for missing, empty, or whitespace-only TipTap docs without title", () => {
  assert.equal(tiptapJsonToMarkdown(null), "");
  assert.equal(tiptapJsonToMarkdown(undefined), "");
  assert.equal(tiptapJsonToMarkdown("not-a-doc"), "");
  assert.equal(tiptapJsonToMarkdown({ type: "doc" }), "");

  assert.equal(
    tiptapJsonToMarkdown({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   \t  " }] },
        { type: "heading", attrs: { level: 2 }, content: [] },
      ],
    }),
    "",
  );
});

test("should prepend title only when missing or different at top of document", () => {
  assert.equal(tiptapJsonToMarkdown(null, { title: "   " }), "");

  assert.equal(
    tiptapJsonToMarkdown(null, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n",
  );

  const withParagraph: TiptapNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Body text." }] },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(withParagraph, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n\nBody text.\n",
  );

  const alreadyTitled: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "2.4   Feature Design" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Content" }] },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(alreadyTitled, { title: "2.4 Feature Design" }),
    "# 2.4   Feature Design\n\nContent\n",
  );

  const subheadingFirst: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "2.4 Feature Design" }],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(subheadingFirst, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n\n## 2.4 Feature Design\n",
  );
});

test("should clamp heading levels 1..6 and accept root content without explicit doc type", () => {
  const doc = {
    content: [
      {
        type: "heading",
        attrs: { level: 0 },
        content: [{ type: "text", text: "Clamped low" }],
      },
      {
        type: "heading",
        attrs: { level: 9 },
        content: [{ type: "text", text: "Clamped high" }],
      },
      {
        type: "heading",
        content: [{ type: "text", text: "Default level" }],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(doc),
    "# Clamped low\n\n###### Clamped high\n\n# Default level\n",
  );

  assert.equal(
    tiptapJsonToMarkdown({
      type: "paragraph",
      content: [{ type: "text", text: "Single node" }],
    }),
    "Single node\n",
  );
});

test("should render inline marks with proper precedence, space preservation, and safe links", () => {
  const doc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Start " },
          { type: "text", text: " bold ", marks: [{ type: "bold" }] },
          { type: "text", text: "strong", marks: [{ type: "strong" }] },
          { type: "text", text: " " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          { type: "text", text: " " },
          { type: "text", text: "em", marks: [{ type: "em" }] },
          { type: "text", text: " " },
          { type: "text", text: "strike", marks: [{ type: "strike" }] },
          { type: "text", text: " " },
          {
            type: "text",
            text: "boldCode",
            marks: [{ type: "bold" }, { type: "code" }],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "`ticked`",
            marks: [{ type: "code" }],
          },
          { type: "text", text: "   ", marks: [{ type: "bold" }] },
          { type: "text", text: "   ", marks: [{ type: "code" }] },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "My ",
            marks: [
              {
                type: "link",
                attrs: { href: "HTTPS://slides.example/deck?slide=1" },
              },
            ],
          },
          {
            type: "text",
            text: "Deck",
            marks: [
              { type: "bold" },
              {
                type: "link",
                attrs: { href: "HTTPS://slides.example/deck?slide=1" },
              },
            ],
          },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "relative",
            marks: [{ type: "link", attrs: { href: "/c/course/doc 1" } }],
          },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "blocked-js",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "blocked-proto-rel",
            marks: [{ type: "link", attrs: { href: "//cdn.example/x" } }],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "blocked-local",
            marks: [
              { type: "link", attrs: { href: "http://127.0.0.1/secret" } },
            ],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "blocked-newline",
            marks: [
              { type: "link", attrs: { href: "https://cdn.example/\nevil" } },
            ],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "ignored-mark",
            marks: [{ type: "unknownMark" }, { type: 123 }],
          },
        ],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(doc),
    [
      "Start  **bold** **strong** *italic* *em* ~~strike~~ **`boldCode`** `` `ticked` ``      ",
      "",
      "[My **Deck**](https://slides.example/deck?slide=1) and [relative](/c/course/doc%201) and blocked-js blocked-proto-rel blocked-local blocked-newline ignored-mark",
      "",
    ]
      .join("\n")
      .replace(/ {6}\n/, "\n"),
  );
});

test("should render nested bullet/ordered lists, start offset, multi-paragraph items, and hardBreaks", () => {
  const doc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Line one " },
                  { type: "hardBreak" },
                  { type: "text", text: " line two" },
                ],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Second paragraph" }],
              },
              {
                type: "orderedList",
                attrs: { start: 3 },
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Third" }],
                      },
                      {
                        type: "bulletList",
                        content: [
                          {
                            type: "listItem",
                            content: [
                              {
                                type: "paragraph",
                                content: [{ type: "text", text: "Grandchild" }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: "listItem",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Fourth" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "List-only item" }],
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
        type: "orderedList",
        attrs: { start: -2 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "One" }] },
            ],
          },
        ],
      },
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Standalone item" }],
          },
        ],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(doc),
    [
      "- Line one  ",
      "  line two",
      "",
      "  Second paragraph",
      "  3. Third",
      "    - Grandchild",
      "  4. Fourth",
      "-",
      "  - List-only item",
      "",
      "1. One",
      "",
      "- Standalone item",
      "",
    ].join("\n"),
  );
});
