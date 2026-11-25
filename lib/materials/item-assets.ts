import {
  stringField,
  resolveSafeUrl,
  activeStorageBlobUrl,
  isExcalidrawUrl,
  isSlidesDeckUrl,
  canonicalDocumentUrlKey,
} from "./item-asset-urls.ts";
import { withEmbeddedVideoMarkdown } from "./item-embedded-video.ts";
import { countItemCompanionDocuments } from "./item-asset-availability.ts";
import {
  externalRecord,
  type ExternalRecord,
} from "../security/external-values.ts";
import {
  htmlBodyToMarkdown,
  tiptapJsonToMarkdown,
  type TiptapEntityRef,
  type TiptapMark,
  type TiptapNode,
} from "./item-markdown.ts";
import { scoreLinkedVideoUrl } from "./linked-video.ts";

export {
  normalizeEmbeddedVideoUrl,
  extractFeaturedMediaEmbed,
  withEmbeddedVideoMarkdown,
} from "./item-embedded-video.ts";
export {
  activeStorageBlobUrl,
  isExcalidrawUrl,
  isSlidesDeckUrl,
  canonicalDocumentUrlKey,
} from "./item-asset-urls.ts";
export { prefixedDocumentFilename } from "./item-asset-filenames.ts";
export {
  countItemCompanionDocuments,
  summarizeItemCompanionDocuments,
  isItemDownloadableForMode,
} from "./item-asset-availability.ts";
export interface ItemFileAsset {
  readonly kind: "image" | "pdf";
  readonly url: string;
  readonly fallbackUrl?: string;
  readonly filename: string;
  readonly contentType?: string;
}

export interface ItemLinkAsset {
  readonly kind: "diagram" | "slides";
  readonly url: string;
  readonly title: string;
}

export interface ItemMarkdownNote {
  readonly title: string;
  readonly markdown: string;
  readonly sourceUrl?: string;
}

export interface EmbeddedVideoLink {
  readonly url: string;
  readonly title?: string;
}

export interface ItemCompanionDocuments {
  readonly markdown: string;
  readonly images: readonly ItemFileAsset[];
  readonly pdfs: readonly ItemFileAsset[];
  readonly diagrams: readonly ItemLinkAsset[];
  readonly slides: readonly ItemLinkAsset[];
  readonly extraNotes?: readonly ItemMarkdownNote[];
}

const PDF_EXTENSION_PATTERN = /\.pdf(?:$|[?#])/i;

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i;

function basenameFromString(raw: string): string {
  if (!raw) return "";

  const last = raw.split(/[\\/]/).pop();

  return last ? last.trim() : "";
}

function filenameFromUrl(url: string, fallback: string): string {
  const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";

  if (!segment) return fallback;

  try {
    return basenameFromString(decodeURIComponent(segment)) || fallback;
  } catch {
    return basenameFromString(segment) || fallback;
  }
}

interface DocumentCollector {
  readonly addImage: (
    asset: ItemFileAsset,
    extraAliases?: readonly (string | null)[],
  ) => void;
  readonly addPdf: (asset: ItemFileAsset) => void;
  readonly addLink: (rawUrl: string, title: string, pageUrl: string) => void;
  readonly build: (markdown: string) => ItemCompanionDocuments;
}

function createDocumentCollector(): DocumentCollector {
  const images: ItemFileAsset[] = [];
  const pdfs: ItemFileAsset[] = [];
  const diagrams: ItemLinkAsset[] = [];
  const slides: ItemLinkAsset[] = [];
  const seenImages = new Set<string>();
  const seenPdfs = new Set<string>();
  const seenDiagrams = new Set<string>();
  const seenSlides = new Set<string>();

  const addImage = (
    asset: ItemFileAsset,
    extraAliases: readonly (string | null)[] = [],
  ): void => {
    const candidates = [
      asset.url,
      asset.fallbackUrl ?? null,
      ...extraAliases,
    ].filter((value): value is string => Boolean(value));

    if (candidates.some((candidate) => seenImages.has(candidate))) return;

    for (const candidate of candidates) seenImages.add(candidate);
    images.push(Object.freeze(asset));
  };

  const addPdf = (asset: ItemFileAsset): void => {
    if (seenPdfs.has(asset.url)) return;

    seenPdfs.add(asset.url);
    pdfs.push(Object.freeze(asset));
  };

  const addLink = (rawUrl: string, title: string, pageUrl: string): void => {
    const resolved = resolveSafeUrl(rawUrl, pageUrl);

    if (!resolved) return;

    const pathname = new URL(resolved).pathname;

    if (PDF_EXTENSION_PATTERN.test(pathname)) {
      const directBlob = activeStorageBlobUrl(resolved);

      addPdf({
        kind: "pdf",
        url: resolved,
        ...(directBlob && directBlob !== resolved
          ? { fallbackUrl: directBlob }
          : {}),
        filename: filenameFromUrl(resolved, "document.pdf"),
      });

      return;
    }

    if (isExcalidrawUrl(resolved)) {
      if (seenDiagrams.has(resolved)) return;

      seenDiagrams.add(resolved);

      diagrams.push(
        Object.freeze({
          kind: "diagram",
          url: resolved,
          title: title.trim() || "Excalidraw diagram",
        }),
      );

      return;
    }

    if (isSlidesDeckUrl(resolved, title) && !seenSlides.has(resolved)) {
      seenSlides.add(resolved);

      slides.push(
        Object.freeze({
          kind: "slides",
          url: resolved,
          title: title.trim() || "Slides",
        }),
      );
    }
  };

  const build = (markdown: string): ItemCompanionDocuments =>
    Object.freeze({
      markdown,
      images: Object.freeze(images),
      pdfs: Object.freeze(pdfs),
      diagrams: Object.freeze(diagrams),
      slides: Object.freeze(slides),
    });

  return { addImage, addPdf, addLink, build };
}

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

function collectAttachments(
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

function extractNodeLinkHref(
  marks: readonly TiptapMark[] | undefined,
  pageUrl: string,
): string | null {
  if (!marks) return null;

  for (const mark of marks) {
    if (mark.type !== "link") continue;

    const attrs = externalRecord(mark.attrs);
    const href = resolveSafeUrl(attrs?.href ?? attrs?.url, pageUrl);

    if (href) return href;
  }

  return null;
}

function collectBodyImageNode(
  node: TiptapNode,
  pageUrl: string,
  collector: DocumentCollector,
  seenSignedIds: Set<string>,
): void {
  const attrs = externalRecord(node.attrs);

  if (!attrs) return;

  const signedId = stringField(attrs.signed_id) || stringField(attrs.signedId);

  if (signedId && seenSignedIds.has(signedId)) return;

  const url = resolveSafeUrl(attrs.url ?? attrs.src, pageUrl);

  if (!url) return;

  const fallbackUrl = activeStorageBlobUrl(url) || undefined;

  const filename =
    basenameFromString(
      stringField(attrs.filename) || stringField(attrs.title),
    ) || filenameFromUrl(url, "image.png");

  collector.addImage({
    kind: "image",
    url,
    ...(fallbackUrl && fallbackUrl !== url ? { fallbackUrl } : {}),
    filename,
  });
}

const RELATED_HEADING_PATTERN = /^conte[uú]dos?\s+relacionados?\b/i;

function addEntityEntry(
  target: Map<string, TiptapEntityRef>,
  sgid: string,
  rawEntry: unknown,
  pageUrl: string,
): void {
  const entry = externalRecord(rawEntry);

  if (!sgid || !entry || target.has(sgid)) return;

  const url = resolveSafeUrl(entry.url, pageUrl);

  if (!url) return;

  const title = stringField(entry.name) || stringField(entry.title);

  target.set(sgid, Object.freeze({ title, url }));
}

/**
 * Builds an sgid-to-entity lookup map from `sgids_to_object_map` and `entities`
 * arrays in a rich-text payload so TipTap `entity` nodes render as Markdown links.
 */
export function buildTiptapEntityMap(
  richTextBody: unknown,
  pageUrl: string,
): Map<string, TiptapEntityRef> {
  const map = new Map<string, TiptapEntityRef>();
  const record = externalRecord(richTextBody);

  if (!record) return map;

  const sgidMap = externalRecord(record.sgids_to_object_map);

  if (sgidMap) {
    for (const [sgid, entry] of Object.entries(sgidMap)) {
      addEntityEntry(map, sgid, entry, pageUrl);
    }
  }

  if (Array.isArray(record.entities)) {
    for (const entry of record.entities) {
      const item = externalRecord(entry);
      const sgid = stringField(item?.sgid);

      addEntityEntry(map, sgid, item, pageUrl);
    }
  }

  return map;
}

function collectNodePlainText(
  node: TiptapNode,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): string {
  const parts: string[] = [];

  if (typeof node.text === "string") parts.push(node.text);

  if (SGID_LINK_NODE_TYPES.has(String(node.type || ""))) {
    const attrs = externalRecord(node.attrs);
    const sgid = stringField(attrs?.sgid);
    const ref = sgid ? entitiesBySgid.get(sgid) : undefined;

    if (ref?.title) parts.push(ref.title);
  }

  for (const child of node.content ?? []) {
    const nested = collectNodePlainText(child, entitiesBySgid);

    if (nested) parts.push(nested);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const SGID_LINK_NODE_TYPES = new Set(["entity", "embed"]);
const EMBED_LINK_NODE_TYPES = new Set(["embed", "iframe", "cta"]);

function firstNonEmptyAttr(
  attrs: ExternalRecord | null,
  keys: readonly string[],
): string {
  if (!attrs) return "";

  const found = keys.find((key) => Boolean(stringField(attrs[key])));

  return found ? stringField(attrs[found]) : "";
}

function resolveDirectNodeUrl(
  node: TiptapNode,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): string {
  const type = typeof node.type === "string" ? node.type : "";
  const attrs = externalRecord(node.attrs);

  if (SGID_LINK_NODE_TYPES.has(type)) {
    const ref = entitiesBySgid.get(stringField(attrs?.sgid));

    if (ref) return ref.url;
  }

  if (SGID_LINK_NODE_TYPES.has(type) || EMBED_LINK_NODE_TYPES.has(type)) {
    return firstNonEmptyAttr(attrs, ["url", "href", "src"]);
  }

  return "";
}

function collectUrlsInNodeOrder(
  nodes: readonly TiptapNode[] | undefined,
  pageUrl: string,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
  collected: string[],
  seen: Set<string>,
): void {
  if (!nodes) return;

  const pushUrl = (rawUrl: unknown): void => {
    const resolved = resolveSafeUrl(rawUrl, pageUrl);

    if (!resolved || seen.has(resolved)) return;
    if (scoreLinkedVideoUrl(resolved, pageUrl) <= 0) return;
    seen.add(resolved);
    collected.push(resolved);
  };

  for (const node of nodes) {
    pushUrl(resolveDirectNodeUrl(node, entitiesBySgid));

    const markHref = extractNodeLinkHref(node.marks, pageUrl);

    if (markHref) pushUrl(markHref);

    collectUrlsInNodeOrder(
      node.content,
      pageUrl,
      entitiesBySgid,
      collected,
      seen,
    );
  }
}

function isStandaloneBoldRelatedHeading(
  block: TiptapNode,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): boolean {
  if (block.type !== "paragraph") return false;

  const plain = collectNodePlainText(block, entitiesBySgid);

  if (!RELATED_HEADING_PATTERN.test(plain)) return false;

  const textChildren = (block.content ?? []).filter(
    (child) => child.type === "text",
  );

  return (
    textChildren.length > 0 &&
    textChildren.every((child) =>
      (child.marks ?? []).some(
        (mark) => mark.type === "bold" || mark.type === "strong",
      ),
    )
  );
}

function isRelatedListOrLinkParagraph(
  block: TiptapNode,
  pageUrl: string,
): boolean {
  if (block.type === "bulletList" || block.type === "orderedList") return true;

  return (
    block.type === "paragraph" &&
    Boolean(
      (block.content ?? []).some((child) =>
        extractNodeLinkHref(child.marks, pageUrl),
      ),
    )
  );
}

function shouldSkipBlockForRelatedLinks(
  block: TiptapNode,
  pageUrl: string,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
  skipState: { headingLevel: number; boldList: boolean },
): boolean {
  if (block.type === "heading") {
    const attrs = externalRecord(block.attrs);
    const rawLevel = typeof attrs?.level === "number" ? attrs.level : 1;
    const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));

    skipState.boldList = false;

    if (skipState.headingLevel && level > skipState.headingLevel) return true;

    const headingText = collectNodePlainText(block, entitiesBySgid);

    skipState.headingLevel = RELATED_HEADING_PATTERN.test(headingText)
      ? level
      : 0;

    return Boolean(skipState.headingLevel);
  }

  if (skipState.headingLevel) return true;

  if (isStandaloneBoldRelatedHeading(block, entitiesBySgid)) {
    skipState.boldList = true;

    return true;
  }

  if (skipState.boldList) {
    if (isRelatedListOrLinkParagraph(block, pageUrl)) return true;

    skipState.boldList = false;
  }

  return false;
}

/**
 * Extracts unique linked post / video URLs from a TipTap rich-text body in
 * document order while skipping any "Conteúdos relacionados" sections.
 */
export function extractRichTextLinkedPostUrls(
  richTextBody: unknown,
  pageUrl: string,
): string[] {
  const record = externalRecord(richTextBody);

  if (!record) return [];

  const entitiesBySgid = buildTiptapEntityMap(record, pageUrl);
  const topBlocks = extractBodyChildren(extractRichTextBodyNode(record)) ?? [];
  const collected: string[] = [];
  const seen = new Set<string>();
  const skipState = { headingLevel: 0, boldList: false };

  for (const block of topBlocks) {
    if (
      shouldSkipBlockForRelatedLinks(block, pageUrl, entitiesBySgid, skipState)
    ) {
      continue;
    }

    collectUrlsInNodeOrder([block], pageUrl, entitiesBySgid, collected, seen);
  }

  return collected.slice(0, 5);
}

function mergeUniqueAssets<T extends { readonly url: string }>(
  primaryList: readonly T[],
  secondaryList: readonly T[],
  kind: ItemFileAsset["kind"] | ItemLinkAsset["kind"],
): readonly T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of [...primaryList, ...secondaryList]) {
    const key = canonicalDocumentUrlKey(item.url, kind);

    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return Object.freeze(merged);
}

function mergeUniqueNotes(
  firstNotes: readonly ItemMarkdownNote[],
  secondNotes: readonly ItemMarkdownNote[],
): readonly ItemMarkdownNote[] {
  const seen = new Set<string>();
  const merged: ItemMarkdownNote[] = [];

  for (const note of [...firstNotes, ...secondNotes]) {
    if (!note.markdown.trim()) continue;

    const key = note.sourceUrl
      ? `url:${canonicalDocumentUrlKey(note.sourceUrl, "note")}`
      : `text:${note.title.trim()}|${note.markdown.trim()}`;

    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(Object.freeze(note));
  }

  return Object.freeze(merged);
}

function buildSecondaryExtraNotes(
  secondary: ItemCompanionDocuments,
  noteMeta?: { readonly title: string; readonly sourceUrl?: string },
): readonly ItemMarkdownNote[] {
  const existing = secondary.extraNotes ?? [];

  if (!noteMeta || !secondary.markdown.trim()) return existing;

  return [
    ...existing,
    Object.freeze({
      title: noteMeta.title.trim() || "Linked note",
      markdown: secondary.markdown,
      ...(noteMeta.sourceUrl ? { sourceUrl: noteMeta.sourceUrl } : {}),
    }),
  ];
}

function combineDocumentCollections(
  base: ItemCompanionDocuments,
  secondary: ItemCompanionDocuments,
  markdown: string,
  extraNotes: readonly ItemMarkdownNote[],
): ItemCompanionDocuments | undefined {
  const merged: ItemCompanionDocuments = Object.freeze({
    markdown,
    images: mergeUniqueAssets(base.images, secondary.images, "image"),
    pdfs: mergeUniqueAssets(base.pdfs, secondary.pdfs, "pdf"),
    diagrams: mergeUniqueAssets(base.diagrams, secondary.diagrams, "diagram"),
    slides: mergeUniqueAssets(base.slides, secondary.slides, "slides"),
    ...(extraNotes.length ? { extraNotes } : {}),
  });

  return countItemCompanionDocuments(merged) > 0 ? merged : undefined;
}

/**
 * Merges two sets of ItemCompanionDocuments, deduplicating files/links by canonical
 * URL and optionally preserving the secondary page's Markdown as a distinct
 * linked-post note (`extraNotes`).
 */
export function mergeItemCompanionDocuments(
  primary: ItemCompanionDocuments | null | undefined,
  secondary: ItemCompanionDocuments | null | undefined,
  options?: {
    readonly secondaryAsExtraNote?: {
      readonly title: string;
      readonly sourceUrl?: string;
    };
  },
): ItemCompanionDocuments | undefined {
  if (!primary && !secondary) return undefined;

  if (!secondary) {
    return primary && countItemCompanionDocuments(primary) > 0
      ? primary
      : undefined;
  }

  const base = primary ?? emptyItemCompanionDocuments();
  const noteMeta = options?.secondaryAsExtraNote;

  const markdown = noteMeta
    ? base.markdown
    : base.markdown || secondary.markdown;

  const extraNotes = mergeUniqueNotes(
    base.extraNotes ?? [],
    buildSecondaryExtraNotes(secondary, noteMeta),
  );

  return combineDocumentCollections(base, secondary, markdown, extraNotes);
}

function embeddedNodeLinkTarget(
  node: TiptapNode,
  type: string,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): { readonly url: string; readonly title: string } | null {
  const attrs = externalRecord(node.attrs);

  if (SGID_LINK_NODE_TYPES.has(type)) {
    const ref = entitiesBySgid.get(stringField(attrs?.sgid));

    if (ref) return ref;
  }

  if (!EMBED_LINK_NODE_TYPES.has(type)) return null;

  const rawUrl = firstNonEmptyAttr(attrs, ["src", "url", "href"]);

  if (!rawUrl) return null;

  return {
    url: rawUrl,
    title: firstNonEmptyAttr(attrs, ["title", "label"]),
  };
}

function collectEmbeddedNodeLink(
  node: TiptapNode,
  type: string,
  pageUrl: string,
  collector: DocumentCollector,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): void {
  const target = embeddedNodeLinkTarget(node, type, entitiesBySgid);

  if (target) collector.addLink(target.url, target.title, pageUrl);
}

function walkBodyNodes(
  nodes: readonly TiptapNode[] | undefined,
  pageUrl: string,
  collector: DocumentCollector,
  seenSignedIds: Set<string>,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): void {
  if (!nodes) return;

  const pendingLink = { href: "", chunks: [] as string[] };

  const flushLink = (): void => {
    if (!pendingLink.href) return;

    collector.addLink(pendingLink.href, pendingLink.chunks.join(""), pageUrl);
    pendingLink.href = "";
    pendingLink.chunks = [];
  };

  for (const node of nodes) {
    if (node.type === "image") {
      flushLink();
      collectBodyImageNode(node, pageUrl, collector, seenSignedIds);
      continue;
    }

    const type = typeof node.type === "string" ? node.type : "";

    collectEmbeddedNodeLink(node, type, pageUrl, collector, entitiesBySgid);

    const linkHref = extractNodeLinkHref(node.marks, pageUrl);

    if (linkHref && node.type === "text" && typeof node.text === "string") {
      if (pendingLink.href && pendingLink.href !== linkHref) flushLink();
      pendingLink.href = linkHref;
      pendingLink.chunks.push(node.text);
      continue;
    }

    flushLink();

    walkBodyNodes(
      node.content,
      pageUrl,
      collector,
      seenSignedIds,
      entitiesBySgid,
    );
  }

  flushLink();
}

function extractRichTextBodyNode(record: ExternalRecord): unknown {
  if (record.body !== undefined) return record.body;

  return record.type === "doc" ? record : null;
}

/**
 * Returns an empty frozen ItemCompanionDocuments object.
 */
export function emptyItemCompanionDocuments(): ItemCompanionDocuments {
  return Object.freeze({
    markdown: "",
    images: Object.freeze([]),
    pdfs: Object.freeze([]),
    diagrams: Object.freeze([]),
    slides: Object.freeze([]),
  });
}

function extractBodyChildren(
  bodyNode: unknown,
): readonly TiptapNode[] | undefined {
  const bodyRecord = externalRecord(bodyNode);

  if (!bodyRecord) return undefined;

  if (Array.isArray(bodyRecord.content)) {
    return bodyRecord.content as readonly TiptapNode[];
  }

  return typeof bodyRecord.type === "string"
    ? [bodyRecord as TiptapNode]
    : undefined;
}

/**
 * Extracts item Markdown and downloadable/linked assets (images, PDFs,
 * Excalidraw diagrams, and slide decks) from a TipTap rich-text payload.
 */
export function extractItemCompanionDocumentsFromRichText(
  richTextBody: unknown,
  options: {
    readonly title?: string;
    readonly pageUrl: string;
    readonly embeddedVideo?: EmbeddedVideoLink | null;
  },
): ItemCompanionDocuments {
  const record = externalRecord(richTextBody);

  if (!record) {
    return withEmbeddedVideoMarkdown(
      emptyItemCompanionDocuments(),
      options.embeddedVideo,
      options.title,
    );
  }

  const collector = createDocumentCollector();
  const seenSignedIds = new Set<string>();
  const entitiesBySgid = buildTiptapEntityMap(record, options.pageUrl);

  collectAttachments(
    record.inline_attachments,
    options.pageUrl,
    collector,
    seenSignedIds,
  );

  collectAttachments(
    record.attachments,
    options.pageUrl,
    collector,
    seenSignedIds,
  );

  const bodyNode = extractRichTextBodyNode(record);

  walkBodyNodes(
    extractBodyChildren(bodyNode),
    options.pageUrl,
    collector,
    seenSignedIds,
    entitiesBySgid,
  );

  const rawMarkdown = tiptapJsonToMarkdown(bodyNode, {
    pageUrl: options.pageUrl,
    entitiesBySgid,
  });

  const markdown = rawMarkdown
    ? tiptapJsonToMarkdown(bodyNode, {
        title: options.title,
        pageUrl: options.pageUrl,
        entitiesBySgid,
      })
    : "";

  return withEmbeddedVideoMarkdown(
    collector.build(markdown),
    options.embeddedVideo,
    options.title,
  );
}

function collectDomImage(
  image: {
    readonly url: string;
    readonly alt?: string;
    readonly filename?: string;
  },
  pageUrl: string,
  collector: DocumentCollector,
): void {
  const resolved = resolveSafeUrl(image.url, pageUrl);

  if (!resolved) return;

  const directBlob = activeStorageBlobUrl(resolved);
  const url = directBlob || resolved;

  const fallbackUrl =
    directBlob && directBlob !== resolved ? resolved : undefined;

  const filename =
    basenameFromString(image.filename ?? "") ||
    filenameFromUrl(url, "image.png");

  collector.addImage(
    {
      kind: "image",
      url,
      ...(fallbackUrl ? { fallbackUrl } : {}),
      filename,
    },
    [resolved],
  );
}

/**
 * Extracts item Markdown and documents from DOM-scraped HTML, `<img>` entries,
 * and `<a>` links as a fallback when structured rich-text JSON is unavailable.
 */
export function extractItemCompanionDocumentsFromLinksAndHtml(input: {
  readonly title?: string;
  readonly pageUrl: string;
  readonly html: string;
  readonly images?: readonly {
    readonly url: string;
    readonly alt?: string;
    readonly filename?: string;
  }[];
  readonly links?: readonly { readonly url: string; readonly text?: string }[];
  readonly embeddedVideo?: EmbeddedVideoLink | null;
}): ItemCompanionDocuments {
  const collector = createDocumentCollector();

  for (const image of input.images ?? []) {
    collectDomImage(image, input.pageUrl, collector);
  }

  for (const link of input.links ?? []) {
    collector.addLink(link.url, link.text ?? "", input.pageUrl);
  }

  const rawMarkdown = htmlBodyToMarkdown(input.html, {
    pageUrl: input.pageUrl,
  });

  const markdown = rawMarkdown
    ? htmlBodyToMarkdown(input.html, {
        title: input.title,
        pageUrl: input.pageUrl,
      })
    : "";

  return withEmbeddedVideoMarkdown(
    collector.build(markdown),
    input.embeddedVideo,
    input.title,
  );
}
