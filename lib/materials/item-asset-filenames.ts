import { sanitizeFilenameStem } from "../shared/filename.ts";

const ITEM_NUMBER_PREFIX_PATTERN = /^(\d+(?:\.\d+)*)\s+/;

const MAX_DOCUMENT_STEM_LENGTH = 116;

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
