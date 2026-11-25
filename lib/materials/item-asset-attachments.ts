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
} from "./item-asset-urls.ts";
import type { ItemFileAsset } from "./item-assets.ts";
import type { DocumentCollector } from "./item-asset-collector.ts";

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i;

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
): ItemFileAsset | null {
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
): ItemFileAsset | null {
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
