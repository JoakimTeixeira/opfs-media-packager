import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const pureRuleFiles = [
  "lib/playlist-queue-policy.ts",
  "lib/filename.ts",
  "lib/hls-master.ts",
  "lib/large-file-remux.ts",
  "lib/security.ts",
  "lib/segments.ts",
  "lib/stream-identity.ts",
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
  assert.deepEqual(
    browserGlobalAccess(
      "chrome.tabs.query({}); window.location.href; document.title;",
    ),
    ["chrome", "window", "document"],
  );

  assert.deepEqual(browserGlobalAccess('const note = "chrome.tabs";'), []);

  assert.deepEqual(
    browserGlobalAccess(
      'chrome["tabs"]; globalThis.chrome; globalThis["document"];',
    ),
    ["chrome", "chrome", "document"],
  );
});

test("should keep selected reusable rules free of direct browser-global access", async () => {
  for (const path of pureRuleFiles) {
    const source = await readFile(
      new URL(`../${path}`, import.meta.url),
      "utf8",
    );

    assert.deepEqual(browserGlobalAccess(source), [], path);
  }
});

test("should keep reusable modules independent of extension entry points", async () => {
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../lib/", import.meta.url);

  const entryPoints = new Set([
    "app",
    "background",
    "content",
    "playlist",
    "popup",
    "page-playlist-probe",
  ]);

  for (const name of await readdir(root)) {
    if (!name.endsWith(".ts")) continue;
    const source = await readFile(new URL(name, root), "utf8");

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

      assert.equal(
        Boolean(target && entryPoints.has(target)),
        false,
        `${name} imports ${specifier}`,
      );
    }
  }
});
