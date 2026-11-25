import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DOWNLOAD_SUBFOLDER,
  downloadRelativePath,
  downloadSubfolderOrDefault,
} from "./download-subfolder.ts";

test("should normalize a configurable relative download subfolder", () => {
  assert.equal(
    downloadSubfolderOrDefault("Courses\\Training"),
    "Courses/Training",
  );

  assert.equal(downloadSubfolderOrDefault("  HLS Videos  "), "HLS Videos");

  assert.equal(
    downloadRelativePath("Courses/Training", "1.1 Lesson.mp4"),
    "Courses/Training/1.1 Lesson.mp4",
  );
});

test("should fall back for unsafe, absolute, or empty download subfolders", () => {
  assert.equal(downloadSubfolderOrDefault(""), DEFAULT_DOWNLOAD_SUBFOLDER);

  assert.equal(
    downloadSubfolderOrDefault("C:\\Users\\example"),
    DEFAULT_DOWNLOAD_SUBFOLDER,
  );

  assert.equal(
    downloadSubfolderOrDefault("/Downloads"),
    DEFAULT_DOWNLOAD_SUBFOLDER,
  );

  assert.equal(
    downloadSubfolderOrDefault("../outside"),
    DEFAULT_DOWNLOAD_SUBFOLDER,
  );

  assert.equal(downloadSubfolderOrDefault("."), DEFAULT_DOWNLOAD_SUBFOLDER);
  assert.equal(downloadSubfolderOrDefault(null), DEFAULT_DOWNLOAD_SUBFOLDER);
});
