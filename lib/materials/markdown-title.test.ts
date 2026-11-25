import { expect, test } from "vitest";
import { withOptionalTitle } from "./markdown-title.ts";

test("should add a missing title without duplicating an existing heading", () => {
  expect(withOptionalTitle(["Body"], "Lesson")).toEqual(["# Lesson", "Body"]);

  expect(withOptionalTitle(["# Lesson", "Body"], "Lesson")).toEqual([
    "# Lesson",
    "Body",
  ]);
});
