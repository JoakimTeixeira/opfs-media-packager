import { expect, test } from "vitest";
import { safeMarkdownHref } from "./markdown-links.ts";

test("should resolve relative links against the lesson page", () => {
  expect(
    safeMarkdownHref("/notes", "https://training.example/course/lesson"),
  ).toBe("https://training.example/notes");

  expect(
    safeMarkdownHref("../slides", "https://training.example/course/lesson"),
  ).toBe("https://training.example/slides");
});

test("should reject unsafe schemes and network-relative URLs", () => {
  expect(safeMarkdownHref("javascript:alert(1)")).toBeNull();
  expect(safeMarkdownHref("//evil.example/path")).toBeNull();
});
