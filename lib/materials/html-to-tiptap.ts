import { safeMarkdownHref } from "./markdown-links.ts";
import type { TiptapMark, TiptapNode } from "./topic-markdown.ts";
import type { HtmlChild, HtmlElementNode } from "./html-tree.ts";

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
      const lastTopic = items[items.length - 1];

      if (lastTopic) lastTopic.content.push(nested);
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

export function htmlChildrenToBlockTiptap(
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
