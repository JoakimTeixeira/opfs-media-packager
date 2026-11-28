import {
  externalRecord,
  type ExternalRecord,
} from "../security/external-values.ts";
import {
  activeStorageBlobUrl,
  basenameFromString,
  filenameFromUrl,
  PDF_EXTENSION_PATTERN,
  resolveSafeUrl,
  stringField,
} from "./topic-asset-urls.ts";
import type {
  AttachedDocumentKind,
  TopicCompanionDocuments,
  TopicFileAsset,
} from "./topic-assets.ts";
import {
  createDocumentCollector,
  type DocumentCollector,
} from "./topic-asset-collector.ts";

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{2,6}$/i;

function isPdfAttachment(
  contentType: string,
  filename: string,
  entryUrl: string | null,
): boolean {
  return (
    contentType === "application/pdf" ||
    PDF_EXTENSION_PATTERN.test(filename) ||
    PDF_EXTENSION_PATTERN.test(entryUrl ?? "")
  );
}

function isImageAttachment(
  contentType: string,
  filename: string,
  entryUrl: string | null,
  nodeType: string,
): boolean {
  return (
    contentType.startsWith("image/") ||
    nodeType === "image" ||
    IMAGE_EXTENSION_PATTERN.test(filename) ||
    IMAGE_EXTENSION_PATTERN.test(entryUrl ?? "")
  );
}

function firstResolvedUrl(
  candidates: readonly unknown[],
  pageUrl: string,
): string | null {
  for (const candidate of candidates) {
    const resolved = resolveSafeUrl(candidate, pageUrl);

    if (resolved) return resolved;
  }

  return null;
}

function rewriteBlobOrKeep(url: string | null): string | null {
  if (!url) return null;

  return activeStorageBlobUrl(url) || url;
}

function optionalFallbackUrl(
  primaryUrl: string,
  candidates: readonly (string | null)[],
): string | undefined {
  return candidates.find(
    (candidate): candidate is string =>
      Boolean(candidate) && candidate !== primaryUrl,
  );
}

function buildPdfAsset(
  entryUrl: string | null,
  variants: ExternalRecord | null,
  rawFilename: string,
  contentType: string,
  pageUrl: string,
): TopicFileAsset | null {
  const variantOriginal = resolveSafeUrl(variants?.original, pageUrl);

  const thumb = rewriteBlobOrKeep(resolveSafeUrl(variants?.thumbnail, pageUrl));

  const url = entryUrl ?? variantOriginal ?? thumb;

  if (!url) return null;

  const fallbackUrl = optionalFallbackUrl(url, [
    thumb,
    activeStorageBlobUrl(url),
    variantOriginal,
  ]);

  return {
    kind: "pdf",
    url,
    ...(fallbackUrl ? { fallbackUrl } : {}),
    filename: rawFilename || filenameFromUrl(url, "document.pdf"),
    ...(contentType ? { contentType } : {}),
  };
}

function buildImageAsset(
  entryUrl: string | null,
  variants: ExternalRecord | null,
  rawFilename: string,
  contentType: string,
  pageUrl: string,
): TopicFileAsset | null {
  const variantOriginal = resolveSafeUrl(variants?.original, pageUrl);

  const fallbackVariant = rewriteBlobOrKeep(
    firstResolvedUrl(
      [variants?.large, variants?.medium, variants?.small, variants?.thumbnail],
      pageUrl,
    ),
  );

  const url = variantOriginal ?? entryUrl ?? fallbackVariant;

  if (!url) return null;

  const fallbackUrl = optionalFallbackUrl(url, [
    activeStorageBlobUrl(url),
    entryUrl,
  ]);

  return {
    kind: "image",
    url,
    ...(fallbackUrl ? { fallbackUrl } : {}),
    filename: rawFilename || filenameFromUrl(url, "image.png"),
    ...(contentType ? { contentType } : {}),
  };
}

const ATTACHED_DOCUMENT_EXTENSION_KINDS: Readonly<
  Record<string, AttachedDocumentKind>
> = Object.freeze({
  pptx: "pptx",
  ppt: "pptx",
  docx: "docx",
  doc: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  csv: "csv",
  md: "md",
  markdown: "md",
  txt: "txt",
  zip: "zip",
  json: "json",
});

const ATTACHED_DOCUMENT_MIME_KINDS: Readonly<
  Record<string, AttachedDocumentKind>
> = Object.freeze({
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/json": "json",
});

const VALID_ATTACHED_DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  "pptx",
  "docx",
  "xlsx",
  "csv",
  "md",
  "txt",
  "zip",
  "json",
  "document",
]);

export function isAttachedDocumentKind(
  value: unknown,
): value is AttachedDocumentKind {
  return typeof value === "string" && VALID_ATTACHED_DOCUMENT_KINDS.has(value);
}

/**
 * Infers a specific document format kind (`pptx`, `docx`, `xlsx`, `csv`, `md`,
 * `txt`, `zip`, `json`) from a filename extension or MIME type.
 */
export function inferAttachedDocumentKind(
  filename: string,
  contentType: string,
): AttachedDocumentKind {
  const extensionMatch = /\.([a-z0-9]{2,8})$/i.exec(filename.trim());

  if (extensionMatch) {
    const kindByExtension =
      ATTACHED_DOCUMENT_EXTENSION_KINDS[extensionMatch[1].toLowerCase()];

    if (kindByExtension) return kindByExtension;
  }

  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  return ATTACHED_DOCUMENT_MIME_KINDS[mimeType] ?? "document";
}

function isDownloadableAttachedDocument(
  contentType: string,
  filename: string,
  nodeType: string,
): boolean {
  if (contentType.startsWith("text/html")) return false;
  if (FILE_EXTENSION_PATTERN.test(filename)) return true;
  if (nodeType === "file") return true;

  return Boolean(
    contentType &&
    !contentType.startsWith("video/") &&
    !contentType.startsWith("audio/"),
  );
}

function buildAttachedDocumentAsset(
  entryUrl: string | null,
  rawFilename: string,
  contentType: string,
): TopicFileAsset | null {
  if (!entryUrl) return null;

  const fallbackUrl = optionalFallbackUrl(entryUrl, [
    activeStorageBlobUrl(entryUrl),
  ]);

  const filename = rawFilename || filenameFromUrl(entryUrl, "document.bin");
  const kind = inferAttachedDocumentKind(filename, contentType);

  return {
    kind,
    url: entryUrl,
    ...(fallbackUrl ? { fallbackUrl } : {}),
    filename,
    ...(contentType ? { contentType } : {}),
  };
}

function collectSingleAttachment(
  rawEntry: unknown,
  pageUrl: string,
  collector: DocumentCollector,
  seenSignedIds: Set<string>,
): void {
  const entry = externalRecord(rawEntry);

  if (!entry) return;

  const signedId = stringField(entry.signed_id) || stringField(entry.signedId);

  if (signedId) seenSignedIds.add(signedId);

  const contentType = (
    stringField(entry.content_type) || stringField(entry.contentType)
  ).toLowerCase();

  const rawFilename = basenameFromString(
    stringField(entry.filename) || stringField(entry.name),
  );

  const entryUrl = resolveSafeUrl(entry.url, pageUrl);
  const variants = externalRecord(entry.image_variants);

  if (isPdfAttachment(contentType, rawFilename, entryUrl)) {
    const pdf = buildPdfAsset(
      entryUrl,
      variants,
      rawFilename,
      contentType,
      pageUrl,
    );

    if (pdf) collector.addPdf(pdf);

    return;
  }

  const nodeType = stringField(entry.type).toLowerCase();

  if (isImageAttachment(contentType, rawFilename, entryUrl, nodeType)) {
    const image = buildImageAsset(
      entryUrl,
      variants,
      rawFilename,
      contentType,
      pageUrl,
    );

    if (image) collector.addImage(image, [entryUrl]);

    return;
  }

  if (isDownloadableAttachedDocument(contentType, rawFilename, nodeType)) {
    const documentAsset = buildAttachedDocumentAsset(
      entryUrl,
      rawFilename,
      contentType,
    );

    if (documentAsset) collector.addFile(documentAsset);
  }
}

export function collectAttachments(
  entries: unknown,
  pageUrl: string,
  collector: DocumentCollector,
  seenSignedIds: Set<string>,
): void {
  if (!Array.isArray(entries)) return;

  for (const rawEntry of entries) {
    collectSingleAttachment(rawEntry, pageUrl, collector, seenSignedIds);
  }
}

function attachmentEntriesFromPayload(payload: unknown): readonly unknown[] {
  if (Array.isArray(payload)) return payload;

  const record = externalRecord(payload);

  return Array.isArray(record?.records) ? record.records : [];
}

/**
 * Extracts attached file records from a paginated `/files` API response or
 * bare attachment record array into `TopicCompanionDocuments`.
 */
export function extractTopicFileAttachments(
  payload: unknown,
  pageUrl: string,
): TopicCompanionDocuments {
  const collector = createDocumentCollector();
  const seenSignedIds = new Set<string>();

  collectAttachments(
    attachmentEntriesFromPayload(payload),
    pageUrl,
    collector,
    seenSignedIds,
  );

  return collector.build("");
}
