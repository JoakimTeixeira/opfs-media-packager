import type { TiptapNode } from "../item-markdown.ts";

export const pastedBulletDoc: TiptapNode = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Links\u200B Úteis\uFE0F" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "•\uFE0F\uFFFC " },
        {
          type: "text",
          text: "https://tool-one.example/",
          marks: [
            {
              type: "link",
              attrs: { href: "https://tool-one.example/" },
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "•\u200B " },
        {
          type: "text",
          text: "https://tool-two.example/",
          marks: [
            { type: "link", attrs: { href: "https://tool-two.example/" } },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "\uF0B7 Normal line" },
        { type: "hardBreak" },
        { type: "text", text: "Second line" },
      ],
    },
    {
      type: "codeBlock",
      content: [{ type: "text", text: "• keep\uFE0F\tindent" }],
    },
  ],
};
