import { test, assert } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const pureRuleFiles = [
  "lib/playlist/playlist-queue-policy.ts",
  "lib/shared/filename.ts",
  "lib/media/hls-master.ts",
  "lib/downloads/large-file-remux.ts",
  "lib/security/security.ts",
  "lib/downloads/segments.ts",
  "lib/media/stream-identity.ts",
];

/** Returns the literal name used to access a global property. */
function globalMemberName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;

  if (node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }

  return "";
}

/** Finds direct browser-global access in a TypeScript source file. */
function browserGlobalAccess(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    "rules.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const receiver = node.expression;

      if (
        ts.isIdentifier(receiver) &&
        ["chrome", "window", "document"].includes(receiver.text)
      ) {
        violations.push(receiver.text);
      }

      if (ts.isIdentifier(receiver) && receiver.text === "globalThis") {
        const member = globalMemberName(node);

        if (["chrome", "window", "document"].includes(member)) {
          violations.push(member);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return violations;
}

test("should detect browser-global access without matching comments or strings", () => {
  assert.deepStrictEqual(
    browserGlobalAccess(
      "chrome.tabs.query({}); window.location.href; document.title;",
    ),
    ["chrome", "window", "document"],
  );

  assert.deepStrictEqual(browserGlobalAccess('const note = "chrome.tabs";'), []);

  assert.deepStrictEqual(
    browserGlobalAccess(
      'chrome["tabs"]; globalThis.chrome; globalThis["document"];',
    ),
    ["chrome", "chrome", "document"],
  );
});

test("should keep selected reusable rules free of direct browser-global access", async () => {
  for (const path of pureRuleFiles) {
    const source = await readFile(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );

    assert.deepStrictEqual(browserGlobalAccess(source), [], path);
  }
});

test("should pair every source module with one colocated unit test", async () => {
  const { readdir } = await import("node:fs/promises");

  for (const directory of ["src", "lib"]) {
    const root = new URL(`../../${directory}/`, import.meta.url);

    const files = (await readdir(root, { recursive: true }))
      .map((name) => name.replaceAll("\\", "/"))
      .filter(
        (name) =>
          name.endsWith(".ts") &&
          !name
            .split("/")
            .some((part) => ["__mocks__", "__fixtures__"].includes(part)),
      );

    const paths = new Set(files);

    for (const file of files) {
      const counterpart = file.endsWith(".test.ts")
        ? file.replace(/\.test\.ts$/, ".ts")
        : file.replace(/\.ts$/, ".test.ts");

      assert.ok(
        paths.has(counterpart),
        `${directory}/${file} needs ${counterpart}`,
      );
    }
  }
});

test("should keep reusable modules independent of extension entry points", async () => {
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../../lib/", import.meta.url);

  const entryPoints = new Set([
    "app",
    "background",
    "content",
    "playlist",
    "popup",
    "page-playlist-probe",
  ]);

  const productionFiles = (await readdir(root, { recursive: true })).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  assert.ok(productionFiles.length > 0, "No reusable modules found");

  for (const name of productionFiles) {
    const source = await readFile(
      new URL(name.replaceAll("\\", "/"), root),
      "utf8",
    );

    const file = ts.createSourceFile(
      name,
      source,
      ts.ScriptTarget.Latest,
      true,
    );

    const imports: string[] = [];

    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        imports.push(node.moduleSpecifier.text);
      }

      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        imports.push(node.arguments[0].text);
      }

      ts.forEachChild(node, visit);
    };

    visit(file);

    for (const specifier of imports) {
      const target = specifier
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.replace(/\.(?:[cm]?[jt]s)$/, "");

      assert.strictEqual(
        Boolean(target && entryPoints.has(target)),
        false,
        `${name} imports ${specifier}`,
      );
    }
  }
});
