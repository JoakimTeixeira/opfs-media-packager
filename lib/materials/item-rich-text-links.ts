import {
  externalRecord,
  type ExternalRecord,
} from "../security/external-values.ts";
import { resolveSafeUrl, stringField } from "./item-asset-urls.ts";
import { scoreLinkedVideoUrl } from "./linked-video.ts";
import type {
  TiptapEntityRef,
  TiptapMark,
  TiptapNode,
} from "./item-markdown.ts";

export function extractNodeLinkHref(
  marks: readonly TiptapMark[] | undefined,
  pageUrl: string,
): string | null {
  if (!marks) return null;

  for (const mark of marks) {
    if (mark.type !== "link") continue;

    const attrs = externalRecord(mark.attrs);
    const href = resolveSafeUrl(attrs?.href ?? attrs?.url, pageUrl);

    if (href) return href;
  }

  return null;
}

const RELATED_HEADING_PATTERN = /^conte[uú]dos?\s+relacionados?\b/i;

function addEntityEntry(
  target: Map<string, TiptapEntityRef>,
  sgid: string,
  rawEntry: unknown,
  pageUrl: string,
): void {
  const entry = externalRecord(rawEntry);

  if (!sgid || !entry || target.has(sgid)) return;

  const url = resolveSafeUrl(entry.url, pageUrl);

  if (!url) return;

  const title = stringField(entry.name) || stringField(entry.title);

  target.set(sgid, Object.freeze({ title, url }));
}

/**
 * Builds an sgid-to-entity lookup map from `sgids_to_object_map` and `entities`
 * arrays in a rich-text payload so TipTap `entity` nodes render as Markdown links.
 */
export function buildTiptapEntityMap(
  richTextBody: unknown,
  pageUrl: string,
): Map<string, TiptapEntityRef> {
  const map = new Map<string, TiptapEntityRef>();
  const record = externalRecord(richTextBody);

  if (!record) return map;

  const sgidMap = externalRecord(record.sgids_to_object_map);

  if (sgidMap) {
    for (const [sgid, entry] of Object.entries(sgidMap)) {
      addEntityEntry(map, sgid, entry, pageUrl);
    }
  }

  if (Array.isArray(record.entities)) {
    for (const entry of record.entities) {
      const item = externalRecord(entry);
      const sgid = stringField(item?.sgid);

      addEntityEntry(map, sgid, item, pageUrl);
    }
  }

  return map;
}

function collectNodePlainText(
  node: TiptapNode,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): string {
  const parts: string[] = [];

  if (typeof node.text === "string") parts.push(node.text);

  if (SGID_LINK_NODE_TYPES.has(String(node.type || ""))) {
    const attrs = externalRecord(node.attrs);
    const sgid = stringField(attrs?.sgid);
    const ref = sgid ? entitiesBySgid.get(sgid) : undefined;

    if (ref?.title) parts.push(ref.title);
  }

  for (const child of node.content ?? []) {
    const nested = collectNodePlainText(child, entitiesBySgid);

    if (nested) parts.push(nested);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export const SGID_LINK_NODE_TYPES = new Set(["entity", "embed"]);

export const EMBED_LINK_NODE_TYPES = new Set(["embed", "iframe", "cta"]);

export function firstNonEmptyAttr(
  attrs: ExternalRecord | null,
  keys: readonly string[],
): string {
  if (!attrs) return "";

  const found = keys.find((key) => Boolean(stringField(attrs[key])));

  return found ? stringField(attrs[found]) : "";
}

function resolveDirectNodeUrl(
  node: TiptapNode,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): string {
  const type = typeof node.type === "string" ? node.type : "";
  const attrs = externalRecord(node.attrs);

  if (SGID_LINK_NODE_TYPES.has(type)) {
    const ref = entitiesBySgid.get(stringField(attrs?.sgid));

    if (ref) return ref.url;
  }

  if (SGID_LINK_NODE_TYPES.has(type) || EMBED_LINK_NODE_TYPES.has(type)) {
    return firstNonEmptyAttr(attrs, ["url", "href", "src"]);
  }

  return "";
}

function collectUrlsInNodeOrder(
  nodes: readonly TiptapNode[] | undefined,
  pageUrl: string,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
  collected: string[],
  seen: Set<string>,
): void {
  if (!nodes) return;

  const pushUrl = (rawUrl: unknown): void => {
    const resolved = resolveSafeUrl(rawUrl, pageUrl);

    if (!resolved || seen.has(resolved)) return;
    if (scoreLinkedVideoUrl(resolved, pageUrl) <= 0) return;
    seen.add(resolved);
    collected.push(resolved);
  };

  for (const node of nodes) {
    pushUrl(resolveDirectNodeUrl(node, entitiesBySgid));

    const markHref = extractNodeLinkHref(node.marks, pageUrl);

    if (markHref) pushUrl(markHref);

    collectUrlsInNodeOrder(
      node.content,
      pageUrl,
      entitiesBySgid,
      collected,
      seen,
    );
  }
}

function isStandaloneBoldRelatedHeading(
  block: TiptapNode,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
): boolean {
  if (block.type !== "paragraph") return false;

  const plain = collectNodePlainText(block, entitiesBySgid);

  if (!RELATED_HEADING_PATTERN.test(plain)) return false;

  const textChildren = (block.content ?? []).filter(
    (child) => child.type === "text",
  );

  return (
    textChildren.length > 0 &&
    textChildren.every((child) =>
      (child.marks ?? []).some(
        (mark) => mark.type === "bold" || mark.type === "strong",
      ),
    )
  );
}

function isRelatedListOrLinkParagraph(
  block: TiptapNode,
  pageUrl: string,
): boolean {
  if (block.type === "bulletList" || block.type === "orderedList") return true;

  return (
    block.type === "paragraph" &&
    Boolean(
      (block.content ?? []).some((child) =>
        extractNodeLinkHref(child.marks, pageUrl),
      ),
    )
  );
}

function shouldSkipBlockForRelatedLinks(
  block: TiptapNode,
  pageUrl: string,
  entitiesBySgid: ReadonlyMap<string, TiptapEntityRef>,
  skipState: { headingLevel: number; boldList: boolean },
): boolean {
  if (block.type === "heading") {
    const attrs = externalRecord(block.attrs);
    const rawLevel = typeof attrs?.level === "number" ? attrs.level : 1;
    const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));

    skipState.boldList = false;

    if (skipState.headingLevel && level > skipState.headingLevel) return true;

    const headingText = collectNodePlainText(block, entitiesBySgid);

    skipState.headingLevel = RELATED_HEADING_PATTERN.test(headingText)
      ? level
      : 0;

    return Boolean(skipState.headingLevel);
  }

  if (skipState.headingLevel) return true;

  if (isStandaloneBoldRelatedHeading(block, entitiesBySgid)) {
    skipState.boldList = true;

    return true;
  }

  if (skipState.boldList) {
    if (isRelatedListOrLinkParagraph(block, pageUrl)) return true;

    skipState.boldList = false;
  }

  return false;
}

/**
 * Extracts unique linked post / video URLs from a TipTap rich-text body in
 * document order while skipping any "Conteúdos relacionados" sections.
 */
export function extractRichTextLinkedPostUrls(
  richTextBody: unknown,
  pageUrl: string,
): string[] {
  const record = externalRecord(richTextBody);

  if (!record) return [];

  const entitiesBySgid = buildTiptapEntityMap(record, pageUrl);
  const topBlocks = extractBodyChildren(extractRichTextBodyNode(record)) ?? [];
  const collected: string[] = [];
  const seen = new Set<string>();
  const skipState = { headingLevel: 0, boldList: false };

  for (const block of topBlocks) {
    if (
      shouldSkipBlockForRelatedLinks(block, pageUrl, entitiesBySgid, skipState)
    ) {
      continue;
    }

    collectUrlsInNodeOrder([block], pageUrl, entitiesBySgid, collected, seen);
  }

  return collected.slice(0, 5);
}

export function extractRichTextBodyNode(record: ExternalRecord): unknown {
  if (record.body !== undefined) return record.body;

  return record.type === "doc" ? record : null;
}

export function extractBodyChildren(
  bodyNode: unknown,
): readonly TiptapNode[] | undefined {
  const bodyRecord = externalRecord(bodyNode);

  if (!bodyRecord) return undefined;

  if (Array.isArray(bodyRecord.content)) {
    return bodyRecord.content as readonly TiptapNode[];
  }

  return typeof bodyRecord.type === "string"
    ? [bodyRecord as TiptapNode]
    : undefined;
}
