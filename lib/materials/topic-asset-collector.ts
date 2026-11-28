import {
  activeStorageBlobUrl,
  filenameFromUrl,
  isExcalidrawUrl,
  isSlidesDeckUrl,
  PDF_EXTENSION_PATTERN,
  resolveSafeUrl,
} from "./topic-asset-urls.ts";
import type {
  TopicCompanionDocuments,
  TopicFileAsset,
  TopicLinkAsset,
} from "./topic-assets.ts";

export interface DocumentCollector {
  readonly addImage: (
    asset: TopicFileAsset,
    extraAliases?: readonly (string | null)[],
  ) => void;
  readonly addPdf: (asset: TopicFileAsset) => void;
  readonly addFile: (asset: TopicFileAsset) => void;
  readonly addLink: (rawUrl: string, title: string, pageUrl: string) => void;
  readonly build: (markdown: string) => TopicCompanionDocuments;
}

export function createDocumentCollector(): DocumentCollector {
  const images: TopicFileAsset[] = [];
  const pdfs: TopicFileAsset[] = [];
  const files: TopicFileAsset[] = [];
  const diagrams: TopicLinkAsset[] = [];
  const slides: TopicLinkAsset[] = [];
  const seenImages = new Set<string>();
  const seenPdfs = new Set<string>();
  const seenFiles = new Set<string>();
  const seenDiagrams = new Set<string>();
  const seenSlides = new Set<string>();

  const addImage = (
    asset: TopicFileAsset,
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

  const addPdf = (asset: TopicFileAsset): void => {
    if (seenPdfs.has(asset.url)) return;

    seenPdfs.add(asset.url);
    pdfs.push(Object.freeze(asset));
  };

  const addFile = (asset: TopicFileAsset): void => {
    if (seenFiles.has(asset.url)) return;

    seenFiles.add(asset.url);
    files.push(Object.freeze(asset));
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

  const build = (markdown: string): TopicCompanionDocuments =>
    Object.freeze({
      markdown,
      images: Object.freeze(images),
      pdfs: Object.freeze(pdfs),
      ...(files.length ? { files: Object.freeze(files) } : {}),
      diagrams: Object.freeze(diagrams),
      slides: Object.freeze(slides),
    });

  return { addImage, addPdf, addFile, addLink, build };
}
