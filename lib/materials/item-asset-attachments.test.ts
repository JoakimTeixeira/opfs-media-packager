import { expect, test } from "vitest";
import { collectAttachments } from "./item-asset-attachments.ts";
import { createDocumentCollector } from "./item-asset-collector.ts";
import { richTextBody } from "./__fixtures__/rich-text-body.ts";

test("should collect downloadable attachments and record their signed identifiers", () => {
  const collector = createDocumentCollector();
  const signedIds = new Set<string>();

  collectAttachments(
    richTextBody.inline_attachments,
    "https://training.example/lesson",
    collector,
    signedIds,
  );

  const documents = collector.build("");

  expect(documents.images).toHaveLength(1);
  expect(documents.pdfs).toHaveLength(1);
  expect(signedIds.has("sig-img-1")).toBe(true);
  expect(signedIds.has("sig-pdf-1")).toBe(true);
});

test("should ignore malformed attachment collections", () => {
  const collector = createDocumentCollector();

  collectAttachments(
    null,
    "https://training.example/lesson",
    collector,
    new Set(),
  );

  expect(collector.build("").images).toEqual([]);
});
