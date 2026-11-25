import { canonicalDocumentUrlKey } from "./item-asset-urls.ts";
import {
  countItemCompanionDocuments,
  emptyItemCompanionDocuments,
} from "./item-asset-availability.ts";
import type {
  ItemCompanionDocuments,
  ItemMarkdownNote,
  ItemFileAsset,
  ItemLinkAsset,
} from "./item-assets.ts";

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
