import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join } from "node:path";

/** Identifies unclosed Markdown fences and diagram statements outside a fence. */
function diagramStructureErrors(markdown: string): string[] {
  const errors: string[] = [];
  const fence = { marker: "", length: 0, start: 0 };

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (boundary) {
      const marker = boundary[1] ?? "";

      if (!fence.marker) {
        fence.marker = marker[0] ?? "";
        fence.length = marker.length;
        fence.start = index + 1;
        continue;
      }

      if (
        marker[0] === fence.marker &&
        marker.length >= fence.length &&
        !boundary[2]?.trim()
      ) {
        fence.marker = "";
      }

      continue;
    }

    if (
      !fence.marker &&
      /^\s*(?:flowchart\s+(?:TD|TB|BT|RL|LR)\b|sequenceDiagram\b|stateDiagram(?:-v2)?\b|[A-Za-z]\w*\s*(?:-->|---|-->>|->>)|[A-Za-z]\w*\[".*\]\s*$)/.test(
        line,
      )
    ) {
      errors.push(
        `Diagram statement outside a code fence at line ${index + 1}`,
      );
    }
  }

  if (fence.marker) errors.push(`Unclosed code fence at line ${fence.start}`);

  return errors;
}

test("should detect unclosed fences and diagram statements outside Markdown fences", () => {
  assert.deepEqual(diagramStructureErrors("```mermaid\nflowchart TD\n"), [
    "Unclosed code fence at line 1",
  ]);

  assert.deepEqual(diagramStructureErrors("Page --> Service\n"), [
    "Diagram statement outside a code fence at line 1",
  ]);

  assert.deepEqual(
    diagramStructureErrors("```mermaid\nflowchart TD\nPage --> Service\n```\n"),
    [],
  );
});

test("should keep Markdown fences closed and diagram statements inside code fences", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));

  const entries = await readdir(join(root, "docs"), {
    recursive: true,
    withFileTypes: true,
  });

  const documentPaths = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .map((entry) => join(entry.parentPath, entry.name));

  const paths = [
    join(root, "README.md"),
    join(root, "SECURITY.md"),
    ...documentPaths,
  ];

  for (const path of paths) {
    assert.deepEqual(
      diagramStructureErrors(await readFile(path, "utf8")),
      [],
      path,
    );
  }
});
