import { sanitizeFilenameStem } from "../shared/filename.ts";

export interface PlaylistItemInput {
  readonly id?: string;
  readonly url?: string;
  readonly fileTitle?: string;
  readonly folderPath?: readonly string[];
  readonly navigationIndex?: number;
}

export interface UsablePlaylistItem {
  readonly id: string;
  readonly url: string;
  readonly fileTitle: string;
  readonly folderPath: readonly string[];
  readonly navigationIndex?: number;
}

export interface PlaylistOutline {
  readonly title: string;
  readonly items: readonly UsablePlaylistItem[];
}

/**
 * Keeps the playlist items that have an address, a unique identifier, and a
 * safe file and folder name for the download queue.
 */
export function usablePlaylistItems(
  items: readonly PlaylistItemInput[],
): readonly UsablePlaylistItem[] {
  const seen = new Set<string>();

  return Object.freeze(
    items.flatMap((item): UsablePlaylistItem[] => {
      if (!item.id || !item.url || seen.has(item.id)) return [];
      seen.add(item.id);

      const navigationIndex =
        typeof item.navigationIndex === "number" &&
        Number.isSafeInteger(item.navigationIndex)
          ? item.navigationIndex
          : null;

      return [
        Object.freeze({
          id: item.id,
          url: item.url,
          fileTitle: sanitizeFilenameStem(item.fileTitle || "Item"),
          folderPath: Object.freeze(
            (item.folderPath || []).map(sanitizeFilenameStem),
          ),
          ...(navigationIndex !== null ? { navigationIndex } : {}),
        }),
      ];
    }),
  );
}

const ROOT_PREFIX_RULES: readonly (readonly [RegExp, string])[] = [
  [/\bworkshops?\b/i, "Workshop"],
  [/\bbootcamps?\b/i, "Bootcamp"],
  [/\bmasterclass(?:es)?\b/i, "Masterclass"],
  [/\b(?:lives?|webinars?)\b/i, "Live"],
  [/\b(?:palestras?|talks?|aulas?\s+ao\s+vivo)\b/i, "Talk"],
  [/\b(?:trilhas?|tracks?)\b/i, "Track"],
];

function urlPathnameWords(pageUrl?: string): string {
  if (!pageUrl) return "";

  try {
    return new URL(pageUrl).pathname.replace(/[-_/]+/g, " ");
  } catch {
    return "";
  }
}

/**
 * Prefixes a playlist root folder with a content-aligned category such as
 * `(Playlist)` or `(Workshop)` instead of a generic numeric prefix.
 */
export function playlistRootFolderName(
  rawTitle: string,
  pageUrl?: string,
): string {
  const title = rawTitle.trim() || "Playlist";

  if (/^\([^)]+\)\s+/.test(title)) return title;

  const haystack = [title, urlPathnameWords(pageUrl)].filter(Boolean).join(" ");

  const matched = ROOT_PREFIX_RULES.find(([pattern]) => pattern.test(haystack));
  const label = matched ? matched[1] : "Playlist";

  return `(${label}) ${title}`;
}

/**
 * Normalizes a playlist item or section title into a punctuation- and
 * accent-insensitive lookup key so raw titles and filename-sanitized titles
 * match identically.
 */
export function normalizeItemTitleKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}
