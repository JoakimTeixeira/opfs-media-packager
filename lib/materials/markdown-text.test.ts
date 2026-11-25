import { expect, test } from "vitest";
import { sanitizeMarkdownText } from "./markdown-text.ts";

test("should remove invisible characters while preserving useful text", () => {
  expect(sanitizeMarkdownText("Olá\u200B mundo\t!\uFE0F")).toBe("Olá mundo !");
  expect(sanitizeMarkdownText("a\tb", { preserveTabs: true })).toBe("a\tb");
});
