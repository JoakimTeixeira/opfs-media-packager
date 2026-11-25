import { sanitizeMarkdownText } from "./markdown-text.ts";

function normalizeHeadingComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function withOptionalTitle(
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
