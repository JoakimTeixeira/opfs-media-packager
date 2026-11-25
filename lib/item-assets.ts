import type { PlaylistDownloadMode } from "./download-preferences.ts";
import { externalRecord, type ExternalRecord } from "./external-values.ts";
import { sanitizeFilenameStem } from "./filename.ts";
import {
  htmlBodyToMarkdown,
  sanitizeMarkdownText,
  tiptapJsonToMarkdown,
  type TiptapEntityRef,
  type TiptapMark,
  type TiptapNode,
} from "./item-markdown.ts";
import { scoreLinkedVideoUrl } from "./linked-video.ts";
import { safeMediaUrl } from "./security.ts";

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

const ACTIVE_STORAGE_REPR_PATTERN =
  /^(.*)\/rails\/active_storage\/representations\/(redirect|proxy)\/([^/]+)\/[^/]+\/([^/]+)$/;

const ACTIVE_STORAGE_LEGACY_REPR_PATTERN =
  /^(.*)\/rails\/active_storage\/representations\/([^/]+)\/[^/]+\/([^/]+)$/;

const EXCALIDRAW_HOST_PATTERN = /(?:^|\.)excalidraw\.com$/i;

const PDF_EXTENSION_PATTERN = /\.pdf(?:$|[?#])/i;

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i;

const NON_SLIDES_EXTENSION_PATTERN =
  /\.(?:pdf|png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

const PLAYLIST_ITEM_ROUTE_PATTERN =
  /^\/c\/.+\/lessons(?:\/|$)|^\/courses(?:\/|$)/i;

const EXCLUDED_SLIDES_HOST_PATTERN =
  /(?:^|\.)(?:github\.com|youtube\.com|youtu\.be|linkedin\.com|x\.com|twitter\.com|amazon\.com|npmjs\.com)$/i;

const SLIDES_ANCHOR_TITLE_PATTERN = /\b(?:slides?|apresenta[cç][aã]o|deck)\b/i;

const ITEM_NUMBER_PREFIX_PATTERN = /^(\d+(?:\.\d+)*)\s+/;

const MAX_DOCUMENT_STEM_LENGTH = 116;

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function basenameFromString(raw: string): string {
  if (!raw) return "";

  const last = raw.split(/[\\/]/).pop();

  return last ? last.trim() : "";
}

function resolveSafeUrl(raw: unknown, pageUrl: string): string | null {
  const trimmed = stringField(raw);

  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return safeMediaUrl(
      trimmed.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase()),
    );
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return null;
  }

  const safePage = safeMediaUrl(pageUrl);

  if (!safePage) return null;

  return safeMediaUrl(new URL(trimmed, safePage).href);
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

/**
 * Rewrites an ActiveStorage representation URL to its original blob URL while
 * preserving origin and mode, or returns null for non-representation URLs.
 */
export function activeStorageBlobUrl(rawUrl: string): string | null {
  const safe = safeMediaUrl(rawUrl);

  if (!safe) return null;

  const parsed = new URL(safe);
  const direct = ACTIVE_STORAGE_REPR_PATTERN.exec(parsed.pathname);

  if (direct) {
    return `${parsed.origin}${direct[1]}/rails/active_storage/blobs/${direct[2]}/${direct[3]}/${direct[4]}`;
  }

  const legacy = ACTIVE_STORAGE_LEGACY_REPR_PATTERN.exec(parsed.pathname);

  if (legacy) {
    return `${parsed.origin}${legacy[1]}/rails/active_storage/blobs/redirect/${legacy[2]}/${legacy[3]}`;
  }

  return null;
}

/**
 * Returns true for safe HTTP(S) URLs hosted on excalidraw.com or a subdomain.
 */
export function isExcalidrawUrl(rawUrl: string): boolean {
  const safe = safeMediaUrl(rawUrl);

  if (!safe) return false;

  return EXCALIDRAW_HOST_PATTERN.test(new URL(safe).hostname);
}

function isDeckLikePath(pathname: string): boolean {
  return (
    pathname === "/" || /\.html?$/i.test(pathname) || /\/slides/i.test(pathname)
  );
}

function isExcludedSlidesTarget(parsed: URL): boolean {
  return (
    parsed.protocol !== "https:" ||
    isExcalidrawUrl(parsed.href) ||
    NON_SLIDES_EXTENSION_PATTERN.test(parsed.pathname) ||
    PLAYLIST_ITEM_ROUTE_PATTERN.test(parsed.pathname) ||
    EXCLUDED_SLIDES_HOST_PATTERN.test(parsed.hostname)
  );
}

/**
 * Returns true when a safe HTTPS URL looks like an interactive slide deck
 * rather than a repo, video, playlist item, or static binary asset.
 */
export function isSlidesDeckUrl(rawUrl: string, anchorTitle?: string): boolean {
  const safe = safeMediaUrl(rawUrl);

  if (!safe) return false;

  const parsed = new URL(safe);

  if (isExcludedSlidesTarget(parsed)) return false;

  const slideParam = parsed.searchParams.get("slide");

  if (slideParam !== null && /^\d+$/.test(slideParam)) return true;

  return Boolean(
    anchorTitle &&
    SLIDES_ANCHOR_TITLE_PATTERN.test(anchorTitle) &&
    isDeckLikePath(parsed.pathname),
  );
}

function stripTrailingPathSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * Normalizes a item document URL into a stable canonical key so identical
 * assets across items (representations vs. blobs, trailing slashes, slide
 * query parameters) are deduplicated reliably.
 */
export function canonicalDocumentUrlKey(
  rawUrl: string,
  kind: ItemFileAsset["kind"] | ItemLinkAsset["kind"] | "note" | "video",
): string {
  const safe = safeMediaUrl(rawUrl);

  if (!safe) return rawUrl.trim();

  const normalized =
    kind === "image" || kind === "pdf"
      ? activeStorageBlobUrl(safe) || safe
      : safe;

  const parsed = new URL(normalized);

  parsed.pathname = stripTrailingPathSlash(parsed.pathname);

  if (kind === "slides") {
    const slideParam = parsed.searchParams.get("slide");

    if (slideParam !== null && /^\d+$/.test(slideParam)) {
      parsed.searchParams.delete("slide");
    }

    parsed.hash = "";

    return parsed.href;
  }

  if (kind === "diagram") {
    if (parsed.hash.length <= 1) parsed.hash = "";

    return parsed.href;
  }

  parsed.hash = "";

  return parsed.href;
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

const YOUTUBE_EMBED_HOST_PATTERN = /(?:^|\.)youtube(?:-nocookie)?\.com$/i;
const YOUTUBE_EMBED_PATH_PATTERN = /^\/embed\/([A-Za-z0-9_-]{6,})/i;
const RELATED_HEADING_PATTERN = /^conte[uú]dos?\s+relacionados?\b/i;

function extractYouTubeVideoId(url: string): string {
  const parsed = new URL(url);

  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.split("/").filter(Boolean)[0] ?? "";
  }

  if (!YOUTUBE_EMBED_HOST_PATTERN.test(parsed.hostname)) return "";

  const embedMatch = YOUTUBE_EMBED_PATH_PATTERN.exec(parsed.pathname);

  if (embedMatch) return embedMatch[1];

  return parsed.searchParams.get("v") ?? "";
}

/**
 * Normalizes embedded player URLs (converting YouTube `/embed/<id>` URLs into
 * canonical `watch?v=<id>` links) after validating HTTP(S) safety.
 */
export function normalizeEmbeddedVideoUrl(
  rawUrl: string,
  pageUrl: string,
): string | null {
  const resolved = resolveSafeUrl(rawUrl, pageUrl);

  if (!resolved) return null;

  const parsed = new URL(resolved);

  if (YOUTUBE_EMBED_HOST_PATTERN.test(parsed.hostname)) {
    const match = YOUTUBE_EMBED_PATH_PATTERN.exec(parsed.pathname);

    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  }

  return resolved;
}

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

/**
 * Extracts an external embedded video URL and title from `featured_media_embed`
 * on a item or post payload, normalizing iframe/embed URLs when needed.
 */
export function extractFeaturedMediaEmbed(
  payload: unknown,
  pageUrl: string,
): { readonly url: string; readonly title: string } | null {
  const root = externalRecord(payload);

  if (!root) return null;

  const item = externalRecord(root.lesson);
  const post = externalRecord(root.post);

  const embed =
    externalRecord(root.featured_media_embed) ??
    externalRecord(item?.featured_media_embed) ??
    externalRecord(post?.featured_media_embed);

  if (!embed) return null;

  const htmlText = stringField(embed.html);

  const iframeSrc = htmlText
    ? (/<iframe[^>]+src=["']([^"']+)["']/i.exec(htmlText)?.[1] ?? "")
    : "";

  const url = normalizeEmbeddedVideoUrl(
    stringField(embed.content) || iframeSrc,
    pageUrl,
  );

  if (!url) return null;

  return Object.freeze({ url, title: stringField(embed.title) });
}

function markdownContainsVideoLink(markdown: string, url: string): boolean {
  if (markdown.includes(url)) return true;

  const videoId = extractYouTubeVideoId(url);

  if (!videoId) return false;

  return (
    markdown.includes(`v=${videoId}`) ||
    markdown.includes(`youtu.be/${videoId}`) ||
    markdown.includes(`/embed/${videoId}`)
  );
}

function formatNonEmptyMarkdownWithVideo(
  current: string,
  videoLine: string,
  fallbackTitle: string,
): string {
  const firstNewline = current.indexOf("\n");

  if (current.startsWith("# ") && firstNewline >= 0) {
    const heading = current.slice(0, firstNewline);
    const rest = current.slice(firstNewline).replace(/^\n+/, "");

    return `${heading}\n\n${videoLine}\n\n${rest}\n`;
  }

  if (current.startsWith("# ")) return `${current}\n\n${videoLine}\n`;

  const cleanTitle = sanitizeMarkdownText(fallbackTitle).trim();
  const header = cleanTitle ? `# ${cleanTitle}\n\n` : "";

  return `${header}${videoLine}\n\n${current}\n`;
}

function formatEmptyMarkdownWithVideo(
  videoLine: string,
  cleanFallback: string,
): string {
  return cleanFallback
    ? `# ${cleanFallback}\n\n${videoLine}\n`
    : `${videoLine}\n`;
}

/**
 * Ensures an embedded external video (such as a YouTube item player) is
 * included in the item's Markdown note without duplicating an existing link.
 */
export function withEmbeddedVideoMarkdown(
  documents: ItemCompanionDocuments,
  embeddedVideo: EmbeddedVideoLink | null | undefined,
  fallbackTitle?: string,
): ItemCompanionDocuments {
  const safeUrl = embeddedVideo?.url ? safeMediaUrl(embeddedVideo.url) : null;

  if (!safeUrl || markdownContainsVideoLink(documents.markdown, safeUrl)) {
    return documents;
  }

  const linkTitle =
    sanitizeMarkdownText(embeddedVideo?.title ?? "").trim() || safeUrl;

  const videoLine = `**Vídeo:** [${linkTitle}](${safeUrl})`;
  const current = documents.markdown.trimEnd();
  const cleanFallback = sanitizeMarkdownText(fallbackTitle ?? "").trim();

  const markdown = current
    ? formatNonEmptyMarkdownWithVideo(current, videoLine, cleanFallback)
    : formatEmptyMarkdownWithVideo(videoLine, cleanFallback);

  return Object.freeze({ ...documents, markdown });
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

/**
 * Extracts a leading outline number prefix such as `"2.4 "` from a item
 * title, or returns `""` when no leading numbering prefix exists.
 */
export function itemNumberPrefix(itemTitle: string): string {
  const match = ITEM_NUMBER_PREFIX_PATTERN.exec(itemTitle.trimStart());

  return match ? `${match[1]} ` : "";
}

function sanitizeOptionalStem(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) return null;

  const sanitized = sanitizeFilenameStem(trimmed);

  if (sanitized === "video" && !/\bvideo\b/i.test(trimmed)) return null;

  return sanitized;
}

/**
 * Builds a Windows-safe document filename prefixed with the item outline
 * number (without duplicating an existing prefix) and bounded in length.
 */
export function prefixedDocumentFilename(
  itemTitle: string,
  rawName: string,
  extension: string,
  fallbackStem?: string,
): string {
  const cleanExt = extension.trim().replace(/^\.+/, "").toLowerCase() || "bin";

  const escapedExt = cleanExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const stripped = rawName
    .trim()
    .replace(new RegExp(`\\.${escapedExt}$`, "i"), "");

  const stem =
    sanitizeOptionalStem(stripped) ??
    sanitizeOptionalStem(fallbackStem ?? "") ??
    "document";

  const prefix = itemNumberPrefix(itemTitle);

  const alreadyPrefixed =
    Boolean(prefix) && (stem.startsWith(prefix) || stem === prefix.trimEnd());

  const withPrefix = prefix && !alreadyPrefixed ? `${prefix}${stem}` : stem;

  const bounded = withPrefix
    .slice(0, MAX_DOCUMENT_STEM_LENGTH)
    .replace(/[.\s-]+$/g, "");

  return `${bounded}.${cleanExt}`;
}

/**
 * Returns the total count of extracted documents for a item.
 */
export function countItemCompanionDocuments(
  documents: ItemCompanionDocuments | null | undefined,
): number {
  if (!documents) return 0;

  return (
    (documents.markdown ? 1 : 0) +
    (documents.extraNotes?.length ?? 0) +
    documents.images.length +
    documents.pdfs.length +
    documents.diagrams.length +
    documents.slides.length
  );
}

function pluralBadge(
  count: number,
  singular: string,
  plural = `${singular}s`,
): readonly string[] {
  if (count <= 0) return [];

  return [`${count} ${count === 1 ? singular : plural}`];
}

/**
 * Returns concise human-readable summary badges for a item's documents.
 */
export function summarizeItemCompanionDocuments(
  documents: ItemCompanionDocuments | null | undefined,
): string[] {
  if (!documents) return [];

  return [
    ...(documents.markdown || documents.extraNotes?.length ? ["MD"] : []),
    ...pluralBadge(documents.pdfs.length, "PDF"),
    ...pluralBadge(documents.images.length, "image"),
    ...pluralBadge(documents.diagrams.length, "diagram"),
    ...pluralBadge(documents.slides.length, "slides", "slides"),
  ];
}

/**
 * Returns true when a discovered item contains at least one downloadable
 * item applicable to the selected playlist download mode.
 */
export function isItemDownloadableForMode(
  item: {
    readonly url?: string;
    readonly qualityOptions?: readonly unknown[];
    readonly subtitles?: readonly unknown[];
    readonly documents?: ItemCompanionDocuments | null;
  },
  mode: PlaylistDownloadMode,
): boolean {
  const hasVideo =
    Boolean(item.url?.trim()) || Boolean(item.qualityOptions?.length);

  const hasSubtitles = Boolean(item.subtitles?.length);
  const hasDocuments = countItemCompanionDocuments(item.documents) > 0;

  if (mode === "documents") return hasDocuments;
  if (mode === "videos") return hasVideo || hasSubtitles;

  return hasVideo || hasSubtitles || hasDocuments;
}
