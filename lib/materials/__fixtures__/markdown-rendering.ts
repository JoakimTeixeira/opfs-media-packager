import type { TiptapNode } from "../item-markdown.ts";

export const headingDoc = {
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

export const inlineFormattingDoc: TiptapNode = {
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
          marks: [{ type: "link", attrs: { href: "http://127.0.0.1/secret" } }],
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

export const nestedListsDoc: TiptapNode = {
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
