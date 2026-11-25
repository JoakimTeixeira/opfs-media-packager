import type { PlaylistDownloadMode } from "../downloads/download-preferences.ts";
import type { ItemCompanionDocuments } from "./item-assets.ts";

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
