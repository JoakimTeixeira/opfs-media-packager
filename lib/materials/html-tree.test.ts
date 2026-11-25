import { expect, test } from "vitest";
import { parseHtmlToElements } from "./html-tree.ts";

test("should decode text and discard script and file-card content", () => {
  const nodes = parseHtmlToElements(
    '<p>Hello &amp; welcome</p><script>bad()</script><div data-testid="editor-content-blocks-file-card">hidden</div>',
  );

  expect(nodes).toEqual([
    {
      kind: "element",
      tag: "p",
      attrs: {},
      skip: false,
      children: [{ kind: "text", text: "Hello & welcome" }],
    },
  ]);
});

test("should retain line breaks and recover from omitted list item closing tags", () => {
  const nodes = parseHtmlToElements("<ul><li>One<br>two<li>Three</ul>");

  expect(nodes).toHaveLength(1);
  const list = nodes[0];

  expect(list.kind).toBe("element");
  if (list.kind !== "element") throw new Error("Expected a list element");
  expect(list.children).toHaveLength(2);
});
