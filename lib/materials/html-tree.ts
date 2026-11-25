export interface HtmlElementNode {
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

export type HtmlChild = HtmlElementNode | HtmlTextNode;

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

export function parseHtmlToElements(html: string): readonly HtmlChild[] {
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
