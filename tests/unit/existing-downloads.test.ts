import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMON_IMAGE_EXTENSIONS,
  buildExistingDownloadIndex,
  findExistingFilenameByExtensions,
  hasExistingDownload,
  normalizeDownloadPath,
} from "../../lib/existing-downloads.ts";

test("should normalize Windows and POSIX download paths consistently", () => {
  assert.equal(
    normalizeDownloadPath(
      "  C:\\Users\\Alice\\Downloads\\Courses//Lesson\\Video.MP4 ",
    ),
    "c:/users/alice/downloads/courses/lesson/video.mp4",
  );

  assert.equal(
    normalizeDownloadPath("./HLS Videos/1.1 Intro.mp4/"),
    "hls videos/1.1 intro.mp4",
  );

  assert.equal(normalizeDownloadPath("///"), "");
});

test("should index only complete, existing, non-empty downloads", () => {
  const index = buildExistingDownloadIndex([
    {
      filename: "C:\\Users\\Bob\\Downloads\\HLS Videos\\Course\\1.1 Intro.mp4",
      state: "complete",
      exists: true,
      fileSize: 1024,
    },
    {
      filename: "/home/bob/Downloads/HLS Videos/Course/1.2 Notes.md",
      exists: true,
    },
    {
      filename:
        "C:\\Users\\Bob\\Downloads\\HLS Videos\\Course\\1.3 Deleted.mp4",
      state: "complete",
      exists: false,
      fileSize: 2048,
    },
    {
      filename: "C:\\Users\\Bob\\Downloads\\HLS Videos\\Course\\1.4 Broken.mp4",
      state: "interrupted",
      exists: true,
      fileSize: 2048,
    },
    {
      filename: "C:\\Users\\Bob\\Downloads\\HLS Videos\\Course\\1.5 Empty.mp4",
      state: "complete",
      exists: true,
      fileSize: 0,
    },
    {
      filename: "///",
      state: "complete",
      exists: true,
      fileSize: 10,
    },
    {
      state: "complete",
      exists: true,
    },
  ]);

  assert.equal(index.size, 2);

  assert.equal(
    hasExistingDownload(index, "HLS Videos/Course/1.1 Intro.mp4"),
    true,
  );

  assert.equal(
    hasExistingDownload(index, "HLS Videos/Course/1.2 notes.md"),
    true,
  );

  assert.equal(
    hasExistingDownload(index, "HLS Videos/Course/1.3 Deleted.mp4"),
    false,
  );

  assert.equal(
    hasExistingDownload(index, "HLS Videos/Course/1.4 Broken.mp4"),
    false,
  );

  assert.equal(
    hasExistingDownload(index, "HLS Videos/Course/1.5 Empty.mp4"),
    false,
  );
});

test("should match exact download relative paths without substring false positives", () => {
  const index = buildExistingDownloadIndex([
    {
      filename: "C:\\Downloads\\MyVideos\\Course\\1.1 Intro.mp4",
      state: "complete",
      exists: true,
      fileSize: 500,
    },
    {
      filename: "HLS Videos/Direct.mp4",
      state: "complete",
      exists: true,
      fileSize: 500,
    },
  ]);

  assert.equal(
    hasExistingDownload(index, "Videos/Course/1.1 Intro.mp4"),
    false,
  );

  assert.equal(
    hasExistingDownload(index, "MyVideos/Course/1.1 Intro.mp4"),
    true,
  );

  assert.equal(hasExistingDownload(index, "HLS Videos/Direct.mp4"), true);
  assert.equal(hasExistingDownload(index, ""), false);
  assert.equal(hasExistingDownload(new Set(), "HLS Videos/Direct.mp4"), false);
});

test("should resolve extensionless image materials against existing downloads", () => {
  const index = buildExistingDownloadIndex([
    {
      filename: "C:\\Downloads\\HLS Videos\\Sec 1\\1.1 - Diagram.webp",
      state: "complete",
      exists: true,
      fileSize: 2048,
    },
    {
      filename: "C:\\Downloads\\RootImage.png",
      state: "complete",
      exists: true,
      fileSize: 2048,
    },
  ]);

  assert.equal(
    findExistingFilenameByExtensions(
      index,
      "HLS Videos/Sec 1",
      (ext) => `1.1 - Diagram.${ext}`,
      COMMON_IMAGE_EXTENSIONS,
    ),
    "1.1 - Diagram.webp",
  );

  assert.equal(
    findExistingFilenameByExtensions(
      index,
      "",
      (ext) => `RootImage.${ext}`,
      COMMON_IMAGE_EXTENSIONS,
    ),
    "RootImage.png",
  );

  assert.equal(
    findExistingFilenameByExtensions(
      index,
      "HLS Videos/Sec 1",
      (ext) => `1.1 - Missing.${ext}`,
      COMMON_IMAGE_EXTENSIONS,
    ),
    null,
  );
});
