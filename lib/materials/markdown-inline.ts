import {
  externalRecord,
  type ExternalRecord,
} from "../security/external-values.ts";
import { safeMarkdownHref } from "./markdown-links.ts";
import { sanitizeMarkdownText } from "./markdown-text.ts";
import type {
  TiptapEntityRef,
  TiptapMark,
  TiptapNode,
} from "./item-markdown.ts";

export interface RenderContext {
  readonly depth: number;
  readonly pageUrl?: string;
  readonly entitiesBySgid?: ReadonlyMap<string, TiptapEntityRef>;
}

export const SKIP_TIPTAP_MEDIA_TYPES = new Set([
  "image",
  "file",
  "attachment",
  "video",
  "audio",
]);

export function stringAttr(
  record: ExternalRecord | null,
  ...keys: readonly string[]
): string {
  if (!record) return "";

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function wrapWithPreservedSpaces(
  text: string,
  prefix: string,
  suffix: string,
): string {
  const leadLen = text.length - text.trimStart().length;
  const trailEnd = text.trimEnd().length;

  if (leadLen >= trailEnd) return text;

  const leading = text.slice(0, leadLen);
  const core = text.slice(leadLen, trailEnd);
  const trailing = text.slice(trailEnd);

  return `${leading}${prefix}${core}${suffix}${trailing}`;
}

export function longestBacktickRun(value: string): number {
  const matches = value.match(/`+/g);

  if (!matches) return 0;

  return matches.reduce((best, run) => Math.max(best, run.length), 0);
}

function wrapInlineCode(text: string): string {
  const leadLen = text.length - text.trimStart().length;
  const trailEnd = text.trimEnd().length;
  const core = text.slice(leadLen, trailEnd);
  const maxTicks = longestBacktickRun(core);
  const fence = "`".repeat(maxTicks + 1);
  const pad = core.startsWith("`") || core.endsWith("`") ? " " : "";

  return `${text.slice(0, leadLen)}${fence}${pad}${core}${pad}${fence}${text.slice(trailEnd)}`;
}

function markTypesSet(marks: readonly TiptapMark[]): Set<string> {
  return new Set(
    marks.map((mark) =>
      typeof mark.type === "string" ? mark.type.toLowerCase() : "",
    ),
  );
}

function applyStyleMarks(text: string, marks: readonly TiptapMark[]): string {
  if (!marks.length || !text.trim()) return text;

  const types = markTypesSet(marks);
  const withCode = types.has("code") ? wrapInlineCode(text) : text;
  const hasItalic = types.has("italic") || types.has("em");

  const withItalic = hasItalic
    ? wrapWithPreservedSpaces(withCode, "*", "*")
    : withCode;

  const hasBold = types.has("bold") || types.has("strong");

  const withBold = hasBold
    ? wrapWithPreservedSpaces(withItalic, "**", "**")
    : withItalic;

  const hasStrike = types.has("strike") || types.has("s") || types.has("del");

  return hasStrike ? wrapWithPreservedSpaces(withBold, "~~", "~~") : withBold;
}

function findLinkHref(
  marks: readonly TiptapMark[] | undefined,
  pageUrl?: string,
): string | null {
  if (!marks) return null;

  for (const mark of marks) {
    if (mark.type !== "link") continue;

    const attrs = externalRecord(mark.attrs);
    const href = safeMarkdownHref(attrs?.href ?? attrs?.url, pageUrl);

    if (href) return href;
  }

  return null;
}

export function extractMediaCaptionLink(
  node: TiptapNode,
  ctx: Pick<RenderContext, "pageUrl" | "entitiesBySgid">,
): string {
  const attrs = externalRecord(node.attrs);

  const caption = sanitizeMarkdownText(
    stringAttr(attrs, "caption", "title", "alt"),
  );

  const attrHref = safeMarkdownHref(attrs?.href ?? attrs?.link, ctx.pageUrl);
  const markHref = findLinkHref(node.marks, ctx.pageUrl);
  const href = attrHref || markHref;

  if (caption && href) return `[${caption}](${href})`;

  if (Array.isArray(node.content) && node.content.length > 0) {
    const nested = renderInlineNodes(node.content, ctx);

    return nested.includes("](") ? nested : "";
  }

  return "";
}

function extractEntityLabel(node: TiptapNode): string {
  const attrs = externalRecord(node.attrs);

  return sanitizeMarkdownText(
    stringAttr(
      attrs,
      "label",
      "title",
      "name",
      "display_name",
      "text",
      "button_text",
    ),
  );
}

function rawNodeLinkCandidate(
  attrs: ExternalRecord | null,
  ref: TiptapEntityRef | undefined,
): unknown {
  return ref ? ref.url : (attrs?.url ?? attrs?.href ?? attrs?.src);
}

function resolveEntityOrLinkTarget(
  node: TiptapNode,
  type: string,
  ctx: Pick<RenderContext, "pageUrl" | "entitiesBySgid">,
): { readonly label: string; readonly href: string | null } {
  const attrs = externalRecord(node.attrs);
  const sgid = typeof attrs?.sgid === "string" ? attrs.sgid : "";

  const ref =
    (type === "entity" || type === "embed") && sgid
      ? ctx.entitiesBySgid?.get(sgid)
      : undefined;

  const label =
    (ref ? sanitizeMarkdownText(ref.title) : "") || extractEntityLabel(node);

  const href = safeMarkdownHref(rawNodeLinkCandidate(attrs, ref), ctx.pageUrl);

  return { label, href };
}

function renderEntityOrLinkNode(
  node: TiptapNode,
  type: string,
  ctx: Pick<RenderContext, "pageUrl" | "entitiesBySgid">,
): string {
  const { label, href } = resolveEntityOrLinkTarget(node, type, ctx);

  if (href) {
    return applyStyleMarks(`[${label || href}](${href})`, node.marks ?? []);
  }

  if (label) return applyStyleMarks(label, node.marks ?? []);

  if (Array.isArray(node.content)) {
    return renderInlineNodes(node.content, ctx);
  }

  return "";
}

function renderUnlinkedInlineNode(
  node: TiptapNode,
  ctx: Pick<RenderContext, "pageUrl" | "entitiesBySgid">,
): string {
  const type = typeof node.type === "string" ? node.type : "";

  if (type === "text") {
    const raw =
      typeof node.text === "string" ? sanitizeMarkdownText(node.text) : "";

    return applyStyleMarks(raw, node.marks ?? []);
  }

  if (type === "hardBreak") return "  \n";

  if (SKIP_TIPTAP_MEDIA_TYPES.has(type)) {
    return extractMediaCaptionLink(node, ctx);
  }

  return renderEntityOrLinkNode(node, type, ctx);
}

export function renderInlineNodes(
  nodes: readonly TiptapNode[] | undefined,
  ctx: Pick<RenderContext, "pageUrl" | "entitiesBySgid">,
): string {
  if (!nodes || nodes.length === 0) return "";

  const parts: string[] = [];
  const pendingLink = { href: "", chunks: [] as string[] };

  const flushPendingLink = (): void => {
    if (!pendingLink.href) return;

    const combined = pendingLink.chunks.join("");

    const wrapped = wrapWithPreservedSpaces(
      combined,
      "[",
      `](${pendingLink.href})`,
    );

    parts.push(wrapped);
    pendingLink.href = "";
    pendingLink.chunks = [];
  };

  for (const node of nodes) {
    const linkHref = findLinkHref(node.marks, ctx.pageUrl);
    const rendered = renderUnlinkedInlineNode(node, ctx);

    if (linkHref && rendered) {
      if (pendingLink.href && pendingLink.href !== linkHref) flushPendingLink();
      pendingLink.href = linkHref;
      pendingLink.chunks.push(rendered);
      continue;
    }

    flushPendingLink();
    if (rendered) parts.push(rendered);
  }

  flushPendingLink();

  return parts.join("");
}
