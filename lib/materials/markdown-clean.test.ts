import { expect, test } from "vitest";
import { cleanItemMarkdown } from "./markdown-clean.ts";

test("should sanitize prose and preserve fenced code indentation", () => {
  expect(cleanItemMarkdown("• First\u200B\n\n```\n\tcode\n```\n")).toBe(
    "- First\n\n```\n\tcode\n```\n",
  );
});
