import { canonicalDocumentUrlKey } from "./topic-asset-urls.ts";
import {
  countTopicCompanionDocuments,
  emptyTopicCompanionDocuments,
} from "./topic-asset-availability.ts";
import type {
  TopicCompanionDocuments,
  TopicMarkdownNote,
  TopicFileAsset,
  TopicLinkAsset,
} from "./topic-assets.ts";

function mergeUniqueAssets<T extends { readonly url: string }>(
  primaryList: readonly T[],
  secondaryList: readonly T[],
  kind: TopicFileAsset["kind"] | TopicLinkAsset["kind"],
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
  firstNotes: readonly TopicMarkdownNote[],
  secondNotes: readonly TopicMarkdownNote[],
): readonly TopicMarkdownNote[] {
  const seen = new Set<string>();
  const merged: TopicMarkdownNote[] = [];

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
  secondary: TopicCompanionDocuments,
  noteMeta?: { readonly title: string; readonly sourceUrl?: string },
): readonly TopicMarkdownNote[] {
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
  base: TopicCompanionDocuments,
  secondary: TopicCompanionDocuments,
  markdown: string,
  extraNotes: readonly TopicMarkdownNote[],
): TopicCompanionDocuments | undefined {
  const files = mergeUniqueAssets(
    base.files ?? [],
    secondary.files ?? [],
    "document",
  );

  const merged: TopicCompanionDocuments = Object.freeze({
    markdown,
    images: mergeUniqueAssets(base.images, secondary.images, "image"),
    pdfs: mergeUniqueAssets(base.pdfs, secondary.pdfs, "pdf"),
    ...(files.length ? { files } : {}),
    diagrams: mergeUniqueAssets(base.diagrams, secondary.diagrams, "diagram"),
    slides: mergeUniqueAssets(base.slides, secondary.slides, "slides"),
    ...(extraNotes.length ? { extraNotes } : {}),
  });

  return countTopicCompanionDocuments(merged) > 0 ? merged : undefined;
}

/**
 * Merges two sets of TopicCompanionDocuments, deduplicating files/links by canonical
 * URL and optionally preserving the secondary page's Markdown as a distinct
 * linked-post note (`extraNotes`).
 */
export function mergeTopicCompanionDocuments(
  primary: TopicCompanionDocuments | null | undefined,
  secondary: TopicCompanionDocuments | null | undefined,
  options?: {
    readonly secondaryAsExtraNote?: {
      readonly title: string;
      readonly sourceUrl?: string;
    };
  },
): TopicCompanionDocuments | undefined {
  if (!primary && !secondary) return undefined;

  if (!secondary) {
    return primary && countTopicCompanionDocuments(primary) > 0
      ? primary
      : undefined;
  }

  const base = primary ?? emptyTopicCompanionDocuments();
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
