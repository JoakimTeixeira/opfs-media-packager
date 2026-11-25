import { assert, expect, test } from "vitest";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

test("should resolve local documentation links to existing project paths", async () => {
  const documentEntries = await readdir(join(projectRoot, "docs"), {
    recursive: true,
    withFileTypes: true,
  });

  const documentPaths = documentEntries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .map((entry) => join(entry.parentPath, entry.name));

  const documents = [
    join(projectRoot, "README.md"),
    join(projectRoot, "SECURITY.md"),
    ...documentPaths,
  ];

  for (const documentPath of documents) {
    const contents = await readFile(documentPath, "utf8");

    for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1] ?? "";
      const target = link.split("#")[0];

      if (target && !/^(?:https?:|mailto:)/i.test(target)) {
        assert.strictEqual(
          link.includes("#"),
          false,
          `${documentPath} uses a cross-file section link: ${link}`,
        );
      }

      if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;

      const resolved = resolve(
        dirname(documentPath),
        decodeURIComponent(target),
      );

      await expect(
        access(resolved),
        `${documentPath} links to a missing path: ${target}`,
      ).resolves.toBeUndefined();
    }
  }
});
