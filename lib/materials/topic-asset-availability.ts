import type { TrackDownloadMode } from "../downloads/download-preferences.ts";
import type {
  TopicCompanionDocuments,
  TopicFileAsset,
} from "./topic-assets.ts";

/**
 * Returns the total count of extracted documents for a item.
 */
export function countTopicCompanionDocuments(
  documents: TopicCompanionDocuments | null | undefined,
): number {
  if (!documents) return 0;

  return (
    (documents.markdown ? 1 : 0) +
    (documents.extraNotes?.length ?? 0) +
    documents.images.length +
    documents.pdfs.length +
    (documents.files?.length ?? 0) +
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

const SPECIFIC_DOCUMENT_BADGES: Readonly<Record<string, string>> =
  Object.freeze({
    pptx: "PPTX",
    docx: "DOCX",
    xlsx: "XLSX",
    csv: "CSV",
    md: "MD",
    txt: "TXT",
    zip: "ZIP",
    json: "JSON",
  });

function summarizeAttachedFiles(
  files: readonly TopicFileAsset[] | undefined,
): readonly string[] {
  if (!files?.length) return [];

  const counts = new Map<string, number>();

  for (const asset of files) {
    counts.set(asset.kind, (counts.get(asset.kind) ?? 0) + 1);
  }

  return [...counts.entries()].flatMap(([kind, count]) => {
    const label = SPECIFIC_DOCUMENT_BADGES[kind];

    return label ? [`${count} ${label}`] : pluralBadge(count, "document");
  });
}

/**
 * Returns concise human-readable summary badges for a item's documents.
 */
export function summarizeTopicCompanionDocuments(
  documents: TopicCompanionDocuments | null | undefined,
): string[] {
  if (!documents) return [];

  return [
    ...(documents.markdown || documents.extraNotes?.length ? ["MD"] : []),
    ...pluralBadge(documents.pdfs.length, "PDF"),
    ...summarizeAttachedFiles(documents.files),
    ...pluralBadge(documents.images.length, "image"),
    ...pluralBadge(documents.diagrams.length, "diagram"),
    ...pluralBadge(documents.slides.length, "slides", "slides"),
  ];
}

/**
 * Returns true when a discovered item contains at least one downloadable
 * item applicable to the selected playlist download mode.
 */
export function isTopicDownloadableForMode(
  item: {
    readonly url?: string;
    readonly qualityOptions?: readonly unknown[];
    readonly subtitles?: readonly unknown[];
    readonly documents?: TopicCompanionDocuments | null;
  },
  mode: TrackDownloadMode,
): boolean {
  const hasVideo =
    Boolean(item.url?.trim()) || Boolean(item.qualityOptions?.length);

  const hasSubtitles = Boolean(item.subtitles?.length);
  const hasDocuments = countTopicCompanionDocuments(item.documents) > 0;

  if (mode === "documents") return hasDocuments;
  if (mode === "videos") return hasVideo || hasSubtitles;

  return hasVideo || hasSubtitles || hasDocuments;
}

/**
 * Returns an empty frozen TopicCompanionDocuments object.
 */
export function emptyTopicCompanionDocuments(): TopicCompanionDocuments {
  return Object.freeze({
    markdown: "",
    images: Object.freeze([]),
    pdfs: Object.freeze([]),
    diagrams: Object.freeze([]),
    slides: Object.freeze([]),
  });
}
