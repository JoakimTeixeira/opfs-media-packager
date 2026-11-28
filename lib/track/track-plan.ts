import { sanitizeFilenameStem } from "../shared/filename.ts";

export interface TrackTopicInput {
  readonly id?: string;
  readonly url?: string;
  readonly fileTitle?: string;
  readonly folderPath?: readonly string[];
  readonly navigationIndex?: number;
}

export interface UsableTrackTopic {
  readonly id: string;
  readonly url: string;
  readonly fileTitle: string;
  readonly folderPath: readonly string[];
  readonly navigationIndex?: number;
}

export interface TrackOutline {
  readonly title: string;
  readonly items: readonly UsableTrackTopic[];
}

/**
 * Keeps the track topics that have an address, a unique identifier, and a
 * safe file and folder name for the download queue.
 */
export function usableTrackTopics(
  topics: readonly TrackTopicInput[],
): readonly UsableTrackTopic[] {
  const seen = new Set<string>();

  return Object.freeze(
    topics.flatMap((topic): UsableTrackTopic[] => {
      if (!topic.id || !topic.url || seen.has(topic.id)) return [];
      seen.add(topic.id);

      const navigationIndex =
        typeof topic.navigationIndex === "number" &&
        Number.isSafeInteger(topic.navigationIndex)
          ? topic.navigationIndex
          : null;

      return [
        Object.freeze({
          id: topic.id,
          url: topic.url,
          fileTitle: sanitizeFilenameStem(topic.fileTitle || "Topic"),
          folderPath: Object.freeze(
            (topic.folderPath || []).map(sanitizeFilenameStem),
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
 * Prefixes a track root folder with a content-aligned category such as
 * `(Track)` or `(Workshop)` instead of a generic numeric prefix.
 */
export function trackRootFolderName(
  rawTitle: string,
  pageUrl?: string,
): string {
  const title = rawTitle.trim() || "Track";

  if (/^\([^)]+\)\s+/.test(title)) return title;

  const haystack = [title, urlPathnameWords(pageUrl)].filter(Boolean).join(" ");

  const matched = ROOT_PREFIX_RULES.find(([pattern]) => pattern.test(haystack));
  const label = matched ? matched[1] : "Track";

  return `(${label}) ${title}`;
}

/**
 * Normalizes a track topic or section title into a punctuation- and
 * accent-insensitive lookup key so raw titles and filename-sanitized titles
 * match identically.
 */
export function normalizeTopicTitleKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}
