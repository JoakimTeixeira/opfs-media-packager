import { expect, test } from "vitest";
import { mergeTopicCompanionDocuments } from "./topic-asset-merge.ts";
import { emptyTopicCompanionDocuments } from "./topic-asset-availability.ts";
import { postNoteMaterials } from "./__fixtures__/post-note-materials.ts";

test("should preserve the primary note and deduplicate companion materials", () => {
  const primary = { ...emptyTopicCompanionDocuments(), markdown: "# Lesson\n" };

  const merged = mergeTopicCompanionDocuments(primary, postNoteMaterials, {
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
  expect(mergeTopicCompanionDocuments(null, null)).toBeUndefined();

  expect(
    mergeTopicCompanionDocuments(emptyTopicCompanionDocuments(), null),
  ).toBeUndefined();
});
