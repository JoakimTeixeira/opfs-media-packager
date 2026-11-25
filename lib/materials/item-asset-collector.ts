import {
  activeStorageBlobUrl,
  filenameFromUrl,
  isExcalidrawUrl,
  isSlidesDeckUrl,
  PDF_EXTENSION_PATTERN,
  resolveSafeUrl,
} from "./item-asset-urls.ts";
import type {
  ItemCompanionDocuments,
  ItemFileAsset,
  ItemLinkAsset,
} from "./item-assets.ts";

export interface DocumentCollector {
  readonly addImage: (
    asset: ItemFileAsset,
    extraAliases?: readonly (string | null)[],
  ) => void;
  readonly addPdf: (asset: ItemFileAsset) => void;
  readonly addLink: (rawUrl: string, title: string, pageUrl: string) => void;
  readonly build: (markdown: string) => ItemCompanionDocuments;
}

export function createDocumentCollector(): DocumentCollector {
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
