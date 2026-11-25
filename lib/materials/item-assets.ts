import { emptyItemCompanionDocuments } from "./item-asset-availability.ts";

export { emptyItemCompanionDocuments } from "./item-asset-availability.ts";
export { mergeItemCompanionDocuments } from "./item-asset-merge.ts";
import {
  SGID_LINK_NODE_TYPES,
  EMBED_LINK_NODE_TYPES,
  firstNonEmptyAttr,
  extractNodeLinkHref,
  extractRichTextBodyNode,
  extractBodyChildren,
  buildTiptapEntityMap,
} from "./item-rich-text-links.ts";

export {
  buildTiptapEntityMap,
  extractRichTextLinkedPostUrls,
} from "./item-rich-text-links.ts";
import { collectAttachments } from "./item-asset-attachments.ts";
import {
  createDocumentCollector,
  type DocumentCollector,
} from "./item-asset-collector.ts";
import {
  basenameFromString,
  filenameFromUrl,
  stringField,
  resolveSafeUrl,
  activeStorageBlobUrl,
} from "./item-asset-urls.ts";
import { withEmbeddedVideoMarkdown } from "./item-embedded-video.ts";
import { externalRecord } from "../security/external-values.ts";
import {
  htmlBodyToMarkdown,
  tiptapJsonToMarkdown,
  type TiptapEntityRef,
  type TiptapNode,
} from "./item-markdown.ts";

export {
  normalizeEmbeddedVideoUrl,
  extractFeaturedMediaEmbed,
  withEmbeddedVideoMarkdown,
} from "./item-embedded-video.ts";
export {
  activeStorageBlobUrl,
  isExcalidrawUrl,
  isSlidesDeckUrl,
  canonicalDocumentUrlKey,
} from "./item-asset-urls.ts";
export { prefixedDocumentFilename } from "./item-asset-filenames.ts";
export {
  countItemCompanionDocuments,
  summarizeItemCompanionDocuments,
  isItemDownloadableForMode,
} from "./item-asset-availability.ts";
export interface ItemFileAsset {
  readonly kind: "image" | "pdf";
  readonly url: string;
  readonly fallbackUrl?: string;
  readonly filename: string;
  readonly contentType?: string;
}

export interface ItemLinkAsset {
  readonly kind: "diagram" | "slides";
  readonly url: string;
  readonly title: string;
}

export interface ItemMarkdownNote {
  readonly title: string;
  readonly markdown: string;
  readonly sourceUrl?: string;
}

export interface EmbeddedVideoLink {
  readonly url: string;
  readonly title?: string;
}

export interface ItemCompanionDocuments {
  readonly markdown: string;
  readonly images: readonly ItemFileAsset[];
  readonly pdfs: readonly ItemFileAsset[];
  readonly diagrams: readonly ItemLinkAsset[];
  readonly slides: readonly ItemLinkAsset[];
  readonly extraNotes?: readonly ItemMarkdownNote[];
}

function collectBodyImageNode(
  node: TiptapNode,
  pageUrl: string,
  collector: DocumentCollector,
  seenSignedIds: Set<string>,
): void {
  const attrs = externalRecord(node.attrs);

  if (!attrs) return;

  const signedId = stringField(attrs.signed_id) || stringField(attrs.signedId);

  if (signedId && seenSignedIds.has(signedId)) return;

  const url = resolveSafeUrl(attrs.url ?? attrs.src, pageUrl);

  if (!url) return;

  const fallbackUrl = activeStorageBlobUrl(url) || undefined;

  const filename =
    basenameFromString(
      stringField(attrs.filename) || stringField(attrs.title),
    ) || filenameFromUrl(url, "image.png");

  collector.addImage({
    kind: "image",
    url,
    ...(fallbackUrl && fallbackUrl !== url ? { fallbackUrl } : {}),
    filename,
  });
}

function embeddedNodeLinkTarget(
  node: TiptapNode,
  type: string,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): { readonly url: string; readonly title: string } | null {
  const attrs = externalRecord(node.attrs);

  if (SGID_LINK_NODE_TYPES.has(type)) {
    const ref = entitiesBySgid.get(stringField(attrs?.sgid));

    if (ref) return ref;
  }

  if (!EMBED_LINK_NODE_TYPES.has(type)) return null;

  const rawUrl = firstNonEmptyAttr(attrs, ["src", "url", "href"]);

  if (!rawUrl) return null;

  return {
    url: rawUrl,
    title: firstNonEmptyAttr(attrs, ["title", "label"]),
  };
}

function collectEmbeddedNodeLink(
  node: TiptapNode,
  type: string,
  pageUrl: string,
  collector: DocumentCollector,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): void {
  const target = embeddedNodeLinkTarget(node, type, entitiesBySgid);

  if (target) collector.addLink(target.url, target.title, pageUrl);
}

function walkBodyNodes(
  nodes: readonly TiptapNode[] | undefined,
  pageUrl: string,
  collector: DocumentCollector,
  seenSignedIds: Set<string>,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): void {
  if (!nodes) return;

  const pendingLink = { href: "", chunks: [] as string[] };

  const flushLink = (): void => {
    if (!pendingLink.href) return;

    collector.addLink(pendingLink.href, pendingLink.chunks.join(""), pageUrl);
    pendingLink.href = "";
    pendingLink.chunks = [];
  };

  for (const node of nodes) {
    if (node.type === "image") {
      flushLink();
      collectBodyImageNode(node, pageUrl, collector, seenSignedIds);
      continue;
    }

    const type = typeof node.type === "string" ? node.type : "";

    collectEmbeddedNodeLink(node, type, pageUrl, collector, entitiesBySgid);

    const linkHref = extractNodeLinkHref(node.marks, pageUrl);

    if (linkHref && node.type === "text" && typeof node.text === "string") {
      if (pendingLink.href && pendingLink.href !== linkHref) flushLink();
      pendingLink.href = linkHref;
      pendingLink.chunks.push(node.text);
      continue;
    }

    flushLink();

    walkBodyNodes(
      node.content,
      pageUrl,
      collector,
      seenSignedIds,
      entitiesBySgid,
    );
  }

  flushLink();
}

/**
 * Extracts item Markdown and downloadable/linked assets (images, PDFs,
 * Excalidraw diagrams, and slide decks) from a TipTap rich-text payload.
 */
export function extractItemCompanionDocumentsFromRichText(
  richTextBody: unknown,
  options: {
    readonly title?: string;
    readonly pageUrl: string;
    readonly embeddedVideo?: EmbeddedVideoLink | null;
  },
): ItemCompanionDocuments {
  const record = externalRecord(richTextBody);

  if (!record) {
    return withEmbeddedVideoMarkdown(
      emptyItemCompanionDocuments(),
      options.embeddedVideo,
      options.title,
    );
  }

  const collector = createDocumentCollector();
  const seenSignedIds = new Set<string>();
  const entitiesBySgid = buildTiptapEntityMap(record, options.pageUrl);

  collectAttachments(
    record.inline_attachments,
    options.pageUrl,
    collector,
    seenSignedIds,
  );

  collectAttachments(
    record.attachments,
    options.pageUrl,
    collector,
    seenSignedIds,
  );

  const bodyNode = extractRichTextBodyNode(record);

  walkBodyNodes(
    extractBodyChildren(bodyNode),
    options.pageUrl,
    collector,
    seenSignedIds,
    entitiesBySgid,
  );

  const rawMarkdown = tiptapJsonToMarkdown(bodyNode, {
    pageUrl: options.pageUrl,
    entitiesBySgid,
  });

  const markdown = rawMarkdown
    ? tiptapJsonToMarkdown(bodyNode, {
        title: options.title,
        pageUrl: options.pageUrl,
        entitiesBySgid,
      })
    : "";

  return withEmbeddedVideoMarkdown(
    collector.build(markdown),
    options.embeddedVideo,
    options.title,
  );
}

function collectDomImage(
  image: {
    readonly url: string;
    readonly alt?: string;
    readonly filename?: string;
  },
  pageUrl: string,
  collector: DocumentCollector,
): void {
  const resolved = resolveSafeUrl(image.url, pageUrl);

  if (!resolved) return;

  const directBlob = activeStorageBlobUrl(resolved);
  const url = directBlob || resolved;

  const fallbackUrl =
    directBlob && directBlob !== resolved ? resolved : undefined;

  const filename =
    basenameFromString(image.filename ?? "") ||
    filenameFromUrl(url, "image.png");

  collector.addImage(
    {
      kind: "image",
      url,
      ...(fallbackUrl ? { fallbackUrl } : {}),
      filename,
    },
    [resolved],
  );
}

/**
 * Extracts item Markdown and documents from DOM-scraped HTML, `<img>` entries,
 * and `<a>` links as a fallback when structured rich-text JSON is unavailable.
 */
export function extractItemCompanionDocumentsFromLinksAndHtml(input: {
  readonly title?: string;
  readonly pageUrl: string;
  readonly html: string;
  readonly images?: readonly {
    readonly url: string;
    readonly alt?: string;
    readonly filename?: string;
  }[];
  readonly links?: readonly { readonly url: string; readonly text?: string }[];
  readonly embeddedVideo?: EmbeddedVideoLink | null;
}): ItemCompanionDocuments {
  const collector = createDocumentCollector();

  for (const image of input.images ?? []) {
    collectDomImage(image, input.pageUrl, collector);
  }

  for (const link of input.links ?? []) {
    collector.addLink(link.url, link.text ?? "", input.pageUrl);
  }

  const rawMarkdown = htmlBodyToMarkdown(input.html, {
    pageUrl: input.pageUrl,
  });

  const markdown = rawMarkdown
    ? htmlBodyToMarkdown(input.html, {
        title: input.title,
        pageUrl: input.pageUrl,
      })
    : "";

  return withEmbeddedVideoMarkdown(
    collector.build(markdown),
    input.embeddedVideo,
    input.title,
  );
}
