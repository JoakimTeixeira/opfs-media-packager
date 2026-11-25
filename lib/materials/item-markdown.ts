import { stripRelatedContentSections } from "./item-markdown-artifacts.ts";

export {
  annotateMarkdownWithDownloadedArtifacts,
  type DownloadedArtifactAnnotation,
} from "./item-markdown-artifacts.ts";
import {
  externalRecord,
  type ExternalRecord,
} from "../security/external-values.ts";
import { safeMediaUrl } from "../security/security.ts";

export interface TiptapMark {
  readonly type?: unknown;
  readonly attrs?: unknown;
}

export interface TiptapNode {
  readonly type?: unknown;
  readonly attrs?: unknown;
  readonly text?: unknown;
  readonly marks?: readonly TiptapMark[];
  readonly content?: readonly TiptapNode[];
}

export interface TiptapEntityRef {
  readonly title: string;
  readonly url: string;
}

interface RenderContext {
  readonly depth: number;
  readonly pageUrl?: string;
  readonly entitiesBySgid?: ReadonlyMap<string, TiptapEntityRef>;
}

interface HtmlElementNode {
  readonly kind: "element";
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly children: HtmlChild[];
  readonly skip: boolean;
}

interface HtmlTextNode {
  readonly kind: "text";
  readonly text: string;
}

type HtmlChild = HtmlElementNode | HtmlTextNode;

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
});

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const SKIP_HTML_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "button",
  "svg",
  "video",
  "audio",
  "media-theme",
  "media-controller",
  "hls-video",
  "mux-video",
  "iframe",
]);

const BLOCK_HTML_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
  "details",
  "summary",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
]);

const SKIP_TIPTAP_MEDIA_TYPES = new Set([
  "image",
  "file",
  "attachment",
  "video",
  "audio",
]);

const BLOCK_TIPTAP_TYPES = new Set([
  "heading",
  "paragraph",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
]);

const MARKDOWN_SPACE_CODES = new Set([
  0x000b, 0x000c, 0x00a0, 0x1680, 0x202f, 0x205f, 0x3000,
]);

const STRIP_CODE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xd800, 0xdfff],
  [0xe000, 0xf8ff],
  [0xfdd0, 0xfdef],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xfffc, 0xffff],
  [0xe0100, 0xe01ef],
  [0xf0000, 0x10ffff],
];

const PASTED_BULLET_LINE_PATTERN = /^[•▪▫◦‣⁃●○]\s+(.*)$/;

function mapMarkdownCodePoint(char: string, preserveTabs: boolean): string {
  const code = char.codePointAt(0) as number;

  if (code === 0x09) return preserveTabs ? "\t" : " ";
  if (code === 0x2028 || code === 0x2029) return "\n";

  if (MARKDOWN_SPACE_CODES.has(code) || (code >= 0x2000 && code <= 0x200a)) {
    return " ";
  }

  if (
    (code & 0xffff) >= 0xfffe ||
    STRIP_CODE_RANGES.some(([min, max]) => code >= min && code <= max)
  ) {
    return "";
  }

  return char;
}

/**
 * Removes unpaired surrogates, variation selectors, invisible format/control
 * characters, replacement glyphs, and Private-Use icons from Markdown text
 * while converting exotic whitespace to standard spaces and normalizing leading
 * Private-Use bullet glyphs.
 */
export function sanitizeMarkdownText(
  raw: string,
  options?: { readonly preserveTabs?: boolean },
): string {
  const preserveTabs = options?.preserveTabs === true;

  const normalizedBullets = raw.replace(
    /(^|\r?\n)[\uE000-\uF8FF](?=\s|$)/g,
    "$1•",
  );

  return Array.from(normalizedBullets, (char) =>
    mapMarkdownCodePoint(char, preserveTabs),
  ).join("");
}

function stringAttr(
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

function resolvePathHref(pathHref: string, pageUrl?: string): string | null {
  const safePage = pageUrl ? safeMediaUrl(pageUrl) : null;

  if (!safePage) return pathHref.replace(/\s/g, "%20");

  return safeMediaUrl(new URL(pathHref, safePage).href);
}

function resolveRelativeHref(href: string, pageUrl?: string): string | null {
  if (!pageUrl || href.startsWith("//") || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;

  const safePage = safeMediaUrl(pageUrl);

  if (!safePage) return null;

  return safeMediaUrl(new URL(href, safePage).href);
}

function safeMarkdownHref(rawHref: unknown, pageUrl?: string): string | null {
  if (typeof rawHref !== "string") return null;

  const trimmed = rawHref.trim();

  if (!trimmed || /[\r\n\0]/.test(trimmed)) return null;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return resolvePathHref(trimmed, pageUrl);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const normalized = trimmed.replace(/^https?:\/\//i, (scheme) =>
      scheme.toLowerCase(),
    );

    return safeMediaUrl(normalized);
  }

  return resolveRelativeHref(trimmed, pageUrl);
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

function longestBacktickRun(value: string): number {
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

function extractMediaCaptionLink(
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

function renderInlineNodes(
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

function cleanInlineBlockText(raw: string): string {
  return raw
    .replace(/[ \t]+ {2}\n/g, "  \n")
    .replace(/ {2}\n[ \t]+/g, "  \n")
    .trim();
}

function renderHeading(node: TiptapNode, ctx: RenderContext): string {
  const attrs = externalRecord(node.attrs);

  const rawLevel =
    typeof attrs?.level === "number" && Number.isFinite(attrs.level)
      ? Math.trunc(attrs.level)
      : 1;

  const level = Math.min(6, Math.max(1, rawLevel));

  const text = cleanInlineBlockText(renderInlineNodes(node.content, ctx));

  return text ? `${"#".repeat(level)} ${text}` : "";
}

function normalizePastedBulletLines(text: string): {
  readonly text: string;
  readonly isBulletOnly: boolean;
} {
  const lines = text.split("\n");
  const tracker = { converted: false, allBullets: lines.length > 0 };

  const normalized = lines.map((line) => {
    const match = PASTED_BULLET_LINE_PATTERN.exec(line.trimStart());

    if (match) {
      tracker.converted = true;

      return `- ${match[1]}`;
    }

    if (line.trim()) tracker.allBullets = false;

    return line;
  });

  return {
    text: normalized.join("\n"),
    isBulletOnly: tracker.converted && tracker.allBullets,
  };
}

function renderParagraph(node: TiptapNode, ctx: RenderContext): string {
  const cleaned = cleanInlineBlockText(renderInlineNodes(node.content, ctx));

  return normalizePastedBulletLines(cleaned).text;
}

function indentContinuationLines(blockText: string, indent: string): string {
  return blockText
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : ""))
    .join("\n");
}

function formatFirstListItemBlock(
  first: { readonly isList: boolean; readonly text: string },
  marker: string,
  baseIndent: string,
  childIndent: string,
): string {
  if (first.isList) return `${baseIndent}${marker.trimEnd()}\n${first.text}`;

  const lines = first.text.split("\n");
  const head = `${baseIndent}${marker}${lines[0]}`;

  const tail = lines
    .slice(1)
    .map((line) => (line ? `${childIndent}${line}` : ""));

  return [head, ...tail].join("\n");
}

function buildListItemBlocks(
  node: TiptapNode,
  ctx: RenderContext,
): { readonly isList: boolean; readonly text: string }[] {
  return (node.content ?? []).flatMap((child) => {
    const isList = child.type === "bulletList" || child.type === "orderedList";

    const text = renderBlockNode(child, {
      ...ctx,
      depth: isList ? ctx.depth + 1 : 0,
    });

    return text ? [{ isList, text }] : [];
  });
}

function formatListItemBlocks(
  renderedBlocks: readonly {
    readonly isList: boolean;
    readonly text: string;
  }[],
  marker: string,
  ctx: RenderContext,
): string {
  if (renderedBlocks.length === 0) return "";

  const baseIndent = "  ".repeat(ctx.depth);
  const childIndent = "  ".repeat(ctx.depth + 1);

  const head = formatFirstListItemBlock(
    renderedBlocks[0],
    marker,
    baseIndent,
    childIndent,
  );

  const tail = renderedBlocks
    .slice(1)
    .map((block) =>
      block.isList
        ? `\n${block.text}`
        : `\n\n${indentContinuationLines(block.text, childIndent)}`,
    )
    .join("");

  return `${head}${tail}`;
}

function renderListItem(
  node: TiptapNode,
  marker: string,
  ctx: RenderContext,
): string {
  return formatListItemBlocks(buildListItemBlocks(node, ctx), marker, ctx);
}

function renderBulletList(node: TiptapNode, ctx: RenderContext): string {
  const items = (node.content ?? [])
    .map((child) => renderListItem(child, "- ", ctx))
    .filter(Boolean);

  return items.join("\n");
}

function renderOrderedList(node: TiptapNode, ctx: RenderContext): string {
  const attrs = externalRecord(node.attrs);

  const start =
    typeof attrs?.start === "number" &&
    Number.isSafeInteger(attrs.start) &&
    attrs.start >= 0
      ? attrs.start
      : 1;

  const items = (node.content ?? [])
    .map((child) => buildListItemBlocks(child, ctx))
    .filter((blocks) => blocks.length > 0);

  return items
    .map((blocks, index) =>
      formatListItemBlocks(blocks, `${start + index}. `, ctx),
    )
    .join("\n");
}

function renderBlockquote(node: TiptapNode, ctx: RenderContext): string {
  const inner = renderBlocks(node.content, { ...ctx, depth: 0 });

  if (inner.length === 0) return "";

  return inner
    .join("\n\n")
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function collectCodeText(nodes: readonly TiptapNode[] | undefined): string {
  if (!nodes) return "";

  return nodes
    .map((child) => {
      if (child.type === "hardBreak") return "\n";

      if (typeof child.text === "string") {
        return sanitizeMarkdownText(child.text, { preserveTabs: true });
      }

      return collectCodeText(child.content);
    })
    .join("");
}

function renderCodeBlock(node: TiptapNode): string {
  const attrs = externalRecord(node.attrs);
  const rawLang = stringAttr(attrs, "language", "lang");
  const lang = rawLang.replace(/[`\r\n]/g, "");
  const code = collectCodeText(node.content).replace(/\r?\n$/, "");

  if (!code.trim()) return "";

  const fence = "`".repeat(Math.max(3, longestBacktickRun(code) + 1));

  return `${fence}${lang}\n${code}\n${fence}`;
}

function renderContainerFallback(node: TiptapNode, ctx: RenderContext): string {
  const children = node.content ?? [];

  const hasBlockChild = children.some(
    (child) =>
      typeof child.type === "string" && BLOCK_TIPTAP_TYPES.has(child.type),
  );

  if (hasBlockChild) return renderBlocks(children, ctx).join("\n\n");

  return cleanInlineBlockText(renderInlineNodes([node], ctx));
}

function renderBlockNode(node: TiptapNode, ctx: RenderContext): string {
  const type = typeof node.type === "string" ? node.type : "";

  const renderers: Readonly<
    Record<string, (n: TiptapNode, c: RenderContext) => string>
  > = {
    heading: renderHeading,
    paragraph: renderParagraph,
    bulletList: renderBulletList,
    orderedList: renderOrderedList,
    listItem: (n, c) => renderListItem(n, "- ", c),
    blockquote: renderBlockquote,
    codeBlock: (n) => renderCodeBlock(n),
    horizontalRule: () => "---",
  };

  const handler = renderers[type];

  if (handler) return handler(node, ctx);

  if (SKIP_TIPTAP_MEDIA_TYPES.has(type)) {
    return extractMediaCaptionLink(node, ctx);
  }

  return renderContainerFallback(node, ctx);
}

function renderBlocks(
  nodes: readonly TiptapNode[] | undefined,
  ctx: RenderContext,
): string[] {
  if (!nodes) return [];

  return nodes.map((node) => renderBlockNode(node, ctx)).filter(Boolean);
}

function extractTopLevelNodes(doc: unknown): readonly TiptapNode[] {
  const record = externalRecord(doc);

  if (!record) return [];

  if (
    record.type === "doc" ||
    (!record.type && Array.isArray(record.content))
  ) {
    return Array.isArray(record.content)
      ? (record.content as readonly TiptapNode[])
      : [];
  }

  return typeof record.type === "string" ? [record as TiptapNode] : [];
}

function isConvertedBulletParagraph(
  node: TiptapNode,
  ctx: RenderContext,
): boolean {
  if (node.type !== "paragraph") return false;

  const cleaned = cleanInlineBlockText(renderInlineNodes(node.content, ctx));

  return Boolean(cleaned) && normalizePastedBulletLines(cleaned).isBulletOnly;
}

function renderBlocksWithTightBullets(
  nodes: readonly TiptapNode[],
  ctx: RenderContext,
): string[] {
  const items: { readonly text: string; readonly tight: boolean }[] = [];

  for (const node of nodes) {
    const text = renderBlockNode(node, ctx);

    if (!text) continue;

    items.push({
      text,
      tight: isConvertedBulletParagraph(node, ctx) && !text.includes("\n"),
    });
  }

  return items.reduce<string[]>((acc, item, index) => {
    const prev = index > 0 ? items[index - 1] : null;

    if (prev?.tight && item.tight && acc.length > 0) {
      acc[acc.length - 1] = `${acc[acc.length - 1]}\n${item.text}`;

      return acc;
    }

    acc.push(item.text);

    return acc;
  }, []);
}

function normalizeHeadingComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function withOptionalTitle(
  blocks: readonly string[],
  rawTitle?: string,
): readonly string[] {
  const title = sanitizeMarkdownText(rawTitle ?? "").trim();

  if (!title) return blocks;

  const first = blocks[0] ?? "";

  const startsWithSameTitle =
    first.startsWith("# ") &&
    normalizeHeadingComparison(first.slice(2)) ===
      normalizeHeadingComparison(title);

  return startsWithSameTitle ? blocks : [`# ${title}`, ...blocks];
}

function renderTiptapWithContext(
  doc: unknown,
  options?: {
    readonly title?: string;
    readonly pageUrl?: string;
    readonly entitiesBySgid?: ReadonlyMap<string, TiptapEntityRef>;
  },
): string {
  const blocks = renderBlocksWithTightBullets(extractTopLevelNodes(doc), {
    depth: 0,
    pageUrl: options?.pageUrl,
    entitiesBySgid: options?.entitiesBySgid,
  });

  const finalBlocks = withOptionalTitle(blocks, options?.title);

  if (finalBlocks.length === 0) return "";

  return stripRelatedContentSections(`${finalBlocks.join("\n\n")}\n`);
}

/**
 * Converts a TipTap/ProseMirror JSON document into clean, readable Markdown.
 */
export function tiptapJsonToMarkdown(
  doc: unknown,
  options?: {
    readonly title?: string;
    readonly pageUrl?: string;
    readonly entitiesBySgid?: ReadonlyMap<string, TiptapEntityRef>;
  },
): string {
  return renderTiptapWithContext(doc, options);
}

function decodeNumericEntity(
  decDigits?: string,
  hexDigits?: string,
): string | null {
  const code = decDigits
    ? Number.parseInt(decDigits, 10)
    : Number.parseInt(hexDigits ?? "", 16);

  if (!Number.isSafeInteger(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;

  return String.fromCodePoint(code);
}

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]+));/g,
    (full, decDigits, hexDigits, named) => {
      if (named) {
        return NAMED_ENTITIES[String(named).toLowerCase()] ?? full;
      }

      return decodeNumericEntity(decDigits, hexDigits) ?? full;
    },
  );
}

function parseHtmlAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  const attrPattern =
    /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of rawAttrs.matchAll(attrPattern)) {
    const name = match[1].toLowerCase();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";

    attrs[name] = decodeHtmlEntities(rawValue);
  }

  return attrs;
}

function isSkippedElement(tag: string, attrs: Record<string, string>): boolean {
  if (SKIP_HTML_TAGS.has(tag)) return true;

  return attrs["data-testid"] === "editor-content-blocks-file-card";
}

function closeTagInStack(stack: HtmlElementNode[], tag: string): void {
  const matchIndex = stack.reduce(
    (found, frame, index) => (index > 0 && frame.tag === tag ? index : found),
    -1,
  );

  if (matchIndex > 0) stack.splice(matchIndex);
}

function handleOpeningTag(
  stack: HtmlElementNode[],
  tag: string,
  rawAttrs: string,
): void {
  const trimmedAttrs = rawAttrs.trimEnd();
  const selfClosing = trimmedAttrs.endsWith("/");
  const cleanAttrs = selfClosing ? trimmedAttrs.slice(0, -1) : trimmedAttrs;
  const attrs = parseHtmlAttributes(cleanAttrs);
  const insideSkip = stack.some((frame) => frame.skip);

  if (VOID_HTML_TAGS.has(tag) || selfClosing) {
    if (!insideSkip && (tag === "br" || tag === "hr")) {
      stack[stack.length - 1].children.push({
        kind: "element",
        tag,
        attrs,
        children: [],
        skip: false,
      });
    }

    return;
  }

  if (tag === "li" && stack[stack.length - 1].tag === "li") {
    stack.pop();
  }

  const skip = insideSkip || isSkippedElement(tag, attrs);

  const element: HtmlElementNode = {
    kind: "element",
    tag,
    attrs,
    children: [],
    skip,
  };

  if (!skip) stack[stack.length - 1].children.push(element);

  stack.push(element);
}

function parseHtmlToElements(html: string): readonly HtmlChild[] {
  const root: HtmlElementNode = {
    kind: "element",
    tag: "root",
    attrs: {},
    children: [],
    skip: false,
  };

  const stack: HtmlElementNode[] = [root];

  const tokenPattern =
    /<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^"'<>]|"[^"]*"|'[^']*')*)>|([^<]+|<)/gi;

  for (const match of html.matchAll(tokenPattern)) {
    const textPart = match[5];

    if (textPart) {
      if (!stack.some((frame) => frame.skip)) {
        stack[stack.length - 1].children.push({
          kind: "text",
          text: decodeHtmlEntities(textPart),
        });
      }

      continue;
    }

    const tagName = match[3]?.toLowerCase();

    if (!tagName) continue;

    if (match[2] === "/") {
      closeTagInStack(stack, tagName);
      continue;
    }

    handleOpeningTag(stack, tagName, match[4]);
  }

  return root.children;
}

function extractPreText(children: readonly HtmlChild[]): string {
  return children
    .map((child) => {
      if (child.kind === "text") return child.text;
      if (child.tag === "br") return "\n";

      const inner = extractPreText(child.children);

      return child.tag === "p" || child.tag === "div" ? `${inner}\n` : inner;
    })
    .join("");
}

function extractCodeLanguage(el: HtmlElementNode): string {
  const direct =
    el.attrs["data-language"] ||
    /(?:language-|lang-)([a-z0-9_+-]+)/i.exec(el.attrs.class ?? "")?.[1] ||
    "";

  if (direct) return direct;

  const firstElement = el.children.find(
    (child): child is HtmlElementNode => child.kind === "element",
  );

  if (!firstElement || firstElement.tag !== "code") return "";

  return (
    firstElement.attrs["data-language"] ||
    /(?:language-|lang-)([a-z0-9_+-]+)/i.exec(
      firstElement.attrs.class ?? "",
    )?.[1] ||
    ""
  );
}

function marksForInlineTag(
  el: HtmlElementNode,
  currentMarks: readonly TiptapMark[],
  pageUrl?: string,
): readonly TiptapMark[] {
  const simpleMarkMap: Readonly<Record<string, string>> = {
    strong: "bold",
    b: "bold",
    em: "italic",
    i: "italic",
    code: "code",
    s: "strike",
    del: "strike",
    strike: "strike",
  };

  const simpleType = simpleMarkMap[el.tag];

  if (simpleType) return [...currentMarks, { type: simpleType }];

  if (el.tag === "a") {
    const href = safeMarkdownHref(el.attrs.href, pageUrl);

    return href
      ? [...currentMarks, { type: "link", attrs: { href } }]
      : currentMarks;
  }

  return currentMarks;
}

function htmlChildrenToInlineTiptap(
  children: readonly HtmlChild[],
  marks: readonly TiptapMark[],
  pageUrl?: string,
): TiptapNode[] {
  return children.flatMap((child): TiptapNode[] => {
    if (child.kind === "text") {
      return [{ type: "text", text: child.text.replace(/\s+/g, " "), marks }];
    }

    if (child.tag === "br") return [{ type: "hardBreak" }];

    const nextMarks = marksForInlineTag(child, marks, pageUrl);

    return htmlChildrenToInlineTiptap(child.children, nextMarks, pageUrl);
  });
}

function buildListTiptapNode(
  el: HtmlElementNode,
  pageUrl?: string,
): TiptapNode {
  const items: { readonly type: "listItem"; readonly content: TiptapNode[] }[] =
    [];

  for (const child of el.children) {
    if (child.kind !== "element") continue;

    if (child.tag === "li") {
      items.push({
        type: "listItem",
        content: htmlChildrenToBlockTiptap(child.children, pageUrl),
      });

      continue;
    }

    if (child.tag === "ul" || child.tag === "ol") {
      const nested = buildListTiptapNode(child, pageUrl);
      const lastItem = items[items.length - 1];

      if (lastItem) lastItem.content.push(nested);
    }
  }

  if (el.tag === "ol") {
    const startNum = Number.parseInt(el.attrs.start ?? "", 10);

    const attrs =
      Number.isSafeInteger(startNum) && startNum >= 0
        ? { start: startNum }
        : {};

    return { type: "orderedList", attrs, content: items };
  }

  return { type: "bulletList", content: items };
}

function htmlElementToBlockTiptap(
  el: HtmlElementNode,
  pageUrl?: string,
): readonly TiptapNode[] {
  if (/^h([1-6])$/.test(el.tag)) {
    return [
      {
        type: "heading",
        attrs: { level: Number(el.tag.slice(1)) },
        content: htmlChildrenToInlineTiptap(el.children, [], pageUrl),
      },
    ];
  }

  if (el.tag === "p") {
    return [
      {
        type: "paragraph",
        content: htmlChildrenToInlineTiptap(el.children, [], pageUrl),
      },
    ];
  }

  if (el.tag === "ul" || el.tag === "ol") {
    return [buildListTiptapNode(el, pageUrl)];
  }

  if (el.tag === "blockquote") {
    return [
      {
        type: "blockquote",
        content: htmlChildrenToBlockTiptap(el.children, pageUrl),
      },
    ];
  }

  if (el.tag === "pre") {
    const language = extractCodeLanguage(el);
    const text = extractPreText(el.children).replace(/^\r?\n/, "");

    return [
      {
        type: "codeBlock",
        attrs: language ? { language } : {},
        content: text ? [{ type: "text", text }] : [],
      },
    ];
  }

  if (el.tag === "hr") return [{ type: "horizontalRule" }];

  return htmlChildrenToBlockTiptap(el.children, pageUrl);
}

function htmlChildrenToBlockTiptap(
  children: readonly HtmlChild[],
  pageUrl?: string,
): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  const inlineRun: HtmlChild[] = [];

  const flushInlineRun = (): void => {
    if (inlineRun.length === 0) return;

    const inlineNodes = htmlChildrenToInlineTiptap(inlineRun, [], pageUrl);

    if (inlineNodes.length > 0) {
      blocks.push({ type: "paragraph", content: inlineNodes });
    }

    inlineRun.length = 0;
  };

  for (const child of children) {
    if (child.kind === "element" && BLOCK_HTML_TAGS.has(child.tag)) {
      flushInlineRun();
      blocks.push(...htmlElementToBlockTiptap(child, pageUrl));
      continue;
    }

    inlineRun.push(child);
  }

  flushInlineRun();

  return blocks;
}

/**
 * Converts HTML item content into clean Markdown without any DOM dependency,
 * stripping scripts, styles, buttons, and file-card preview widget noise.
 */
export function htmlBodyToMarkdown(
  html: string,
  options?: { readonly title?: string; readonly pageUrl?: string },
): string {
  if (typeof html !== "string" || !html.trim()) {
    return renderTiptapWithContext(null, options);
  }

  const elements = parseHtmlToElements(html);
  const blockNodes = htmlChildrenToBlockTiptap(elements, options?.pageUrl);

  return renderTiptapWithContext({ type: "doc", content: blockNodes }, options);
}

/**
 * Sanitizes pre-rendered Markdown line by line (outside fenced code blocks),
 * stripping invisible/control/PUA characters and converting pasted Unicode
 * bullet lines into standard `- ` Markdown items while preserving code fences.
 */
export function cleanItemMarkdown(markdown: string): string {
  if (!markdown) return "";

  const fence = { active: false };

  const cleaned = markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fence.active = !fence.active;

        return sanitizeMarkdownText(line, { preserveTabs: true });
      }

      if (fence.active) {
        return sanitizeMarkdownText(line, { preserveTabs: true });
      }

      return normalizePastedBulletLines(sanitizeMarkdownText(line)).text;
    })
    .join("\n");

  return stripRelatedContentSections(cleaned);
}
