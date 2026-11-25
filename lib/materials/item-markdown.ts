import { normalizePastedBulletLines } from "./markdown-clean.ts";
import { withOptionalTitle } from "./markdown-title.ts";

export { cleanItemMarkdown } from "./markdown-clean.ts";
import { sanitizeMarkdownText } from "./markdown-text.ts";
import {
  SKIP_TIPTAP_MEDIA_TYPES,
  stringAttr,
  renderInlineNodes,
  longestBacktickRun,
  extractMediaCaptionLink,
  type RenderContext,
} from "./markdown-inline.ts";

export { sanitizeMarkdownText } from "./markdown-text.ts";
import { htmlChildrenToBlockTiptap } from "./html-to-tiptap.ts";
import { parseHtmlToElements } from "./html-tree.ts";
import { stripRelatedContentSections } from "./item-markdown-artifacts.ts";

export {
  annotateMarkdownWithDownloadedArtifacts,
  type DownloadedArtifactAnnotation,
} from "./item-markdown-artifacts.ts";
import { externalRecord } from "../security/external-values.ts";

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
