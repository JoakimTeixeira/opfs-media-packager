import { sanitizeMarkdownText } from "./markdown-text.ts";
import { stripRelatedContentSections } from "./topic-markdown-artifacts.ts";

const PASTED_BULLET_LINE_PATTERN = /^[•▪▫◦‣⁃●○]\s+(.*)$/;

export function normalizePastedBulletLines(text: string): {
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

/**
 * Sanitizes pre-rendered Markdown line by line (outside fenced code blocks),
 * stripping invisible/control/PUA characters and converting pasted Unicode
 * bullet lines into standard `- ` Markdown items while preserving code fences.
 */
export function cleanTopicMarkdown(markdown: string): string {
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
