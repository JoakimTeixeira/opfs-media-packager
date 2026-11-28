import { safeMediaUrl } from "../security/security.ts";
import type { TopicFileAsset, TopicLinkAsset } from "./topic-assets.ts";

const ACTIVE_STORAGE_REPR_PATTERN =
  /^(.*)\/rails\/active_storage\/representations\/(redirect|proxy)\/([^/]+)\/[^/]+\/([^/]+)$/;

const ACTIVE_STORAGE_LEGACY_REPR_PATTERN =
  /^(.*)\/rails\/active_storage\/representations\/([^/]+)\/[^/]+\/([^/]+)$/;

const EXCALIDRAW_HOST_PATTERN = /(?:^|\.)excalidraw\.com$/i;

const NON_SLIDES_EXTENSION_PATTERN =
  /\.(?:pdf|png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

const TRACK_TOPIC_ROUTE_PATTERN =
  /^\/c\/.+\/lessons(?:\/|$)|^\/courses(?:\/|$)/i;

const EXCLUDED_SLIDES_HOST_PATTERN =
  /(?:^|\.)(?:github\.com|youtube\.com|youtu\.be|linkedin\.com|x\.com|twitter\.com|amazon\.com|npmjs\.com)$/i;

const SLIDES_ANCHOR_TITLE_PATTERN = /\b(?:slides?|apresenta[cç][aã]o|deck)\b/i;

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
    TRACK_TOPIC_ROUTE_PATTERN.test(parsed.pathname) ||
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
  kind: TopicFileAsset["kind"] | TopicLinkAsset["kind"] | "note" | "video",
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

export function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveSafeUrl(raw: unknown, pageUrl: string): string | null {
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

export const PDF_EXTENSION_PATTERN = /\.pdf(?:$|[?#])/i;

export function basenameFromString(raw: string): string {
  if (!raw) return "";

  const last = raw.split(/[\\/]/).pop();

  return last ? last.trim() : "";
}

export function filenameFromUrl(url: string, fallback: string): string {
  const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";

  if (!segment) return fallback;

  try {
    return basenameFromString(decodeURIComponent(segment)) || fallback;
  } catch {
    return basenameFromString(segment) || fallback;
  }
}
