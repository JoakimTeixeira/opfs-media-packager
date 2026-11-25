import { expect, test } from "vitest";
import { htmlChildrenToBlockTiptap } from "./html-to-tiptap.ts";
import { parseHtmlToElements } from "./html-tree.ts";

test("should convert headings, links, and list items to rich-text nodes", () => {
  const html =
    '<h2>Lesson</h2><p><a href="/guide">Guide</a></p><ul><li>First</li></ul>';

  const nodes = htmlChildrenToBlockTiptap(
    parseHtmlToElements(html),
    "https://training.example/lesson",
  );

  expect(nodes.map((node) => node.type)).toEqual([
    "heading",
    "paragraph",
    "bulletList",
  ]);

  expect(JSON.stringify(nodes)).toContain("https://training.example/guide");
});
