import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaFilename,
  sanitizeFilenameStem,
  subtitleFilename,
  videoFilename,
} from "../lib/filename.ts";

test("should use a readable Windows-safe title", () => {
  assert.equal(
    videoFilename(
      "🔴 Métricas na Prática: Como Medir, Evoluir e Organizar Times | Engineering Course",
    ),
    "Métricas na Prática - Como Medir Evoluir e Organizar Times - Engineering Course.mp4",
  );
});

test("should remove forbidden filename characters and icons", () => {
  const filename = videoFilename("📹 Test <bad> / name?*");

  assert.equal(filename, "Test bad name.mp4");
  assert.doesNotMatch(filename, /[<>:"/\\|?*]|\p{Extended_Pictographic}/u);
});

test("should give the subtitle the same video stem", () => {
  const video = videoFilename("Lesson: Intro | Course");

  assert.equal(
    subtitleFilename(video, "https://media.example/caption.vtt"),
    "Lesson - Intro - Course.vtt",
  );

  assert.equal(
    subtitleFilename(video, "https://media.example/caption.srt"),
    "Lesson - Intro - Course.srt",
  );

  assert.equal(
    subtitleFilename(
      video,
      "https://cdn.example/00000000-0000-4000-8000-000000000001.vtt",
    ),
    "Lesson - Intro - Course.vtt",
  );
});

test("should keep the same clean video and subtitle stem for MKV", () => {
  const video = mediaFilename("🔴 Lesson: Intro | Course", "mkv");

  assert.equal(video, "Lesson - Intro - Course.mkv");

  assert.equal(
    subtitleFilename(video, "https://media.example/uuid.vtt"),
    "Lesson - Intro - Course.vtt",
  );
});

test("should never return an empty filename stem", () => {
  assert.equal(sanitizeFilenameStem("🔴|:"), "video");
});

test("should normalize MKV input and fall back to VTT for extensionless sidecars", () => {
  assert.equal(mediaFilename("Lesson.mkv", "mp4"), "Lesson.mp4");

  assert.equal(
    subtitleFilename("Lesson.mkv", "https://media.example/caption"),
    "Lesson.vtt",
  );
});

test("should normalize unicode, separator spacing, trailing punctuation, and long titles", () => {
  assert.equal(
    sanitizeFilenameStem("  Café\u212B  --  Part 1...  "),
    "CaféÅ - Part 1",
  );

  assert.equal(sanitizeFilenameStem("... - \u{1F534} - ..."), "video");
  assert.equal(sanitizeFilenameStem("x".repeat(117)).length, 116);
});

test("should remove only a final filename extension and preserve media extensions in a title", () => {
  assert.equal(
    mediaFilename("MP4 introduction.mp4 notes", "mkv"),
    "MP4 introduction.mp4 notes.mkv",
  );

  assert.equal(mediaFilename("movie.MKV", "mp4"), "movie.mp4");

  assert.equal(
    subtitleFilename(
      "Lesson.mp4",
      "https://media.example/caption.VTT?download=1",
    ),
    "Lesson.vtt",
  );
});
