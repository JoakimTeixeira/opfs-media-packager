import { expect, test } from "vitest";
import { mergeItemCompanionDocuments } from "./item-asset-merge.ts";
import { emptyItemCompanionDocuments } from "./item-asset-availability.ts";
import { postNoteMaterials } from "./__fixtures__/post-note-materials.ts";

test("should preserve the primary note and deduplicate companion materials", () => {
  const primary = { ...emptyItemCompanionDocuments(), markdown: "# Lesson\n" };

  const merged = mergeItemCompanionDocuments(primary, postNoteMaterials, {
    secondaryAsExtraNote: {
      title: "Linked post",
      sourceUrl: "https://training.example/post",
    },
  });

  expect(merged?.markdown).toBe("# Lesson\n");
  expect(merged?.extraNotes).toHaveLength(2);
  expect(merged?.images).toHaveLength(1);
});

test("should return no materials for empty input", () => {
  expect(mergeItemCompanionDocuments(null, null)).toBeUndefined();

  expect(
    mergeItemCompanionDocuments(emptyItemCompanionDocuments(), null),
  ).toBeUndefined();
});
