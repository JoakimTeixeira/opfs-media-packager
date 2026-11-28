import { expect, test } from "vitest";
import {
  collectAttachments,
  extractTopicFileAttachments,
  inferAttachedDocumentKind,
  isAttachedDocumentKind,
} from "./topic-asset-attachments.ts";
import { createDocumentCollector } from "./topic-asset-collector.ts";
import { syntheticOpaqueAssetUrl } from "./__fixtures__/attachment-tokens.ts";
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

test("should extract generic attached documents from paginated /files API records", () => {
  const deckUrl = syntheticOpaqueAssetUrl("deck-overview");

  const payload = {
    count: 4,
    records: [
      {
        id: 1,
        filename: "Deck Overview.pptx",
        content_type:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        signed_id: "sig-pptx-1",
        url: deckUrl,
      },
      {
        id: 2,
        filename: "Deck Overview.pptx",
        url: deckUrl,
      },
      {
        id: 3,
        filename: "Checklist.pdf",
        content_type: "application/pdf",
        url: "https://assets.example.net/pdf-token-2",
      },
      {
        id: 4,
        type: "file",
        url: "https://assets.example.net/rails/active_storage/representations/redirect/sig99/var/guide.zip",
      },
      {
        id: 5,
        filename: "page.html",
        content_type: "text/html",
        url: "https://assets.example.net/not-a-file",
      },
      {
        id: 6,
        content_type: "video/mp4",
        url: "https://assets.example.net/clip",
      },
      {
        id: 7,
        type: "file",
        url: "javascript:alert(1)",
      },
    ],
  };

  const documents = extractTopicFileAttachments(
    payload,
    "https://training.example/c/topic/sections/1/lessons/2",
  );

  expect(documents.pdfs).toHaveLength(1);
  expect(documents.pdfs[0]?.filename).toBe("Checklist.pdf");
  expect(documents.files).toHaveLength(2);

  expect(documents.files?.[0]).toMatchObject({
    kind: "pptx",
    filename: "Deck Overview.pptx",
    url: deckUrl,
  });

  expect(documents.files?.[1]).toMatchObject({
    kind: "zip",
    filename: "guide.zip",
    fallbackUrl:
      "https://assets.example.net/rails/active_storage/blobs/redirect/sig99/guide.zip",
  });

  const fromArray = extractTopicFileAttachments(
    [
      {
        content_type: "application/octet-stream",
        url: "https://assets.example.net/raw-token",
      },
      {
        filename: "Notes.md",
        content_type: "text/markdown",
        url: "https://assets.example.net/notes-token",
      },
      {
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        url: "https://assets.example.net/doc-token",
      },
    ],
    "https://training.example/lesson",
  );

  expect(fromArray.files?.[0]).toMatchObject({
    kind: "document",
    filename: "raw-token",
  });

  expect(fromArray.files?.[1]?.kind).toBe("md");
  expect(fromArray.files?.[2]?.kind).toBe("docx");

  expect(
    extractTopicFileAttachments(null, "https://training.example/lesson").files,
  ).toBeUndefined();

  expect(isAttachedDocumentKind("pptx")).toBe(true);
  expect(isAttachedDocumentKind("docx")).toBe(true);
  expect(isAttachedDocumentKind("pdf")).toBe(false);
  expect(isAttachedDocumentKind(null)).toBe(false);
  expect(inferAttachedDocumentKind("sheet.xlsx", "")).toBe("xlsx");

  expect(inferAttachedDocumentKind("data", "text/csv; charset=utf-8")).toBe(
    "csv",
  );
});
