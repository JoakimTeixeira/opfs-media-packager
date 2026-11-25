import { expect, test } from "vitest";
import {
  buildTiptapEntityMap,
  extractRichTextLinkedPostUrls,
} from "./item-rich-text-links.ts";
import { complexRichText } from "./__fixtures__/complex-rich-text.ts";

test("should resolve linked entities and omit related-content links", () => {
  const page =
    "https://training.example/c/sample-course/sections/10/lessons/20";

  expect(buildTiptapEntityMap(complexRichText, page).size).toBe(6);

  expect(extractRichTextLinkedPostUrls(complexRichText, page)).toEqual([
    "https://training.example/c/comunidade/post-1",
    "https://training.example/c/comunidade/post-2",
    "https://training.example/c/events/preview-session",
    "https://training.example/c/comunidade/post-3",
    "https://training.example/c/comunidade/post-final",
  ]);
});
