import { test } from "vitest";
import assert from "node:assert/strict";
import { icon } from "./icons.ts";

interface FakeSvgElement {
  readonly attributes: Record<string, string>;
  readonly children: FakeSvgElement[];
  readonly tagName: string;
  appendChild(child: FakeSvgElement): void;
  setAttribute(name: string, value: string): void;
}

function restoreDocument(previousDocument: Document | undefined): void {
  if (previousDocument === undefined) {
    Reflect.deleteProperty(globalThis, "document");

    return;
  }

  globalThis.document = previousDocument;
}

test("should create a styled Lucide SVG using only the requested icon", () => {
  const previousDocument: Document | undefined = globalThis.document;
  const created: FakeSvgElement[] = [];

  const fakeDocument = {
    createElementNS(_namespace: string, tagName: string): FakeSvgElement {
      const element: FakeSvgElement = {
        attributes: {},
        children: [],
        appendChild(child: FakeSvgElement): void {
          this.children.push(child);
        },
        setAttribute(name: string, value: string): void {
          this.attributes[name] = value;
        },
        tagName,
      };

      created.push(element);

      return element;
    },
  };

  globalThis.document = fakeDocument as unknown as Document;

  try {
    const rendered = icon("download", [
      "button-icon",
    ]) as unknown as FakeSvgElement;

    assert.equal(rendered.tagName, "svg");
    assert.equal(rendered.attributes.class, "lucide-icon button-icon");
    assert.equal(rendered.attributes["aria-hidden"], "true");
    assert.equal(rendered.attributes["stroke-width"], "2");
    assert.ok(rendered.children.length > 0);
    assert.ok(created.length > 1);
  } finally {
    restoreDocument(previousDocument);
  }
});
