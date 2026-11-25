import { expect, test } from "vitest";
import { renderInlineNodes } from "./markdown-inline.ts";

test("should combine adjacent linked text and preserve formatting", () => {
  expect(
    renderInlineNodes(
      [
        {
          type: "text",
          text: "Read ",
          marks: [{ type: "link", attrs: { href: "/guide" } }],
        },
        {
          type: "text",
          text: "this",
          marks: [
            { type: "link", attrs: { href: "/guide" } },
            { type: "bold" },
          ],
        },
      ],
      { pageUrl: "https://training.example/course" },
    ),
  ).toBe("[Read **this**](https://training.example/guide)");
});

test("should ignore media without a linked caption", () => {
  expect(
    renderInlineNodes(
      [{ type: "image", attrs: { src: "https://assets.example/a.png" } }],
      {},
    ),
  ).toBe("");
});
