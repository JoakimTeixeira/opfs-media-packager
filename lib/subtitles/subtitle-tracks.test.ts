import { test } from "vitest";
import assert from "node:assert/strict";
import {
  hasSpokenSubtitleCues,
  isStoryboardSubtitleUrl,
  isSubtitleResourceUrl,
  isTranscriptMetadataUrl,
  uniqueKnownSubtitleTracks,
} from "./subtitle-tracks.ts";

test("should keep one usable option when the same language is detected twice", () => {
  const tracks = uniqueKnownSubtitleTracks(
    [{ url: "https://media.example/manifest-pt.vtt", language: "Portuguese" }],
    [{ url: "https://media.example/uuid.vtt", language: "Portuguese" }],
  );

  assert.deepEqual(tracks, [
    { url: "https://media.example/manifest-pt.vtt", language: "Portuguese" },
  ]);
});

test("should drop tracks with an unknown language or missing URL", () => {
  assert.deepEqual(
    uniqueKnownSubtitleTracks(null, [
      { url: "https://media.example/unknown.vtt", language: "" },
      { url: "", language: "English" },
      { url: "https://media.example/no-language.vtt" },
      { url: "https://media.example/en.vtt", language: "English" },
    ]),
    [{ url: "https://media.example/en.vtt", language: "English" }],
  );
});

test("should trim fields, retain metadata, and deduplicate language case-insensitively", () => {
  const tracks = uniqueKnownSubtitleTracks([
    {
      url: "  https://media.example/pt.vtt  ",
      language: " Portuguese ",
      label: "PT",
    },
    {
      url: "https://media.example/pt-other.vtt",
      language: "portuguese",
      label: "Duplicate",
    },
  ]);

  assert.deepEqual(tracks, [
    {
      url: "https://media.example/pt.vtt",
      language: "Portuguese",
      label: "PT",
    },
  ]);
});

test("should not retain malformed optional fields or alter a canonical language key", () => {
  assert.deepEqual(
    uniqueKnownSubtitleTracks([
      { url: "https://media.example/en.vtt", language: "ENGLISH" },
      { url: "   ", language: "Spanish" },
    ]),
    [
      {
        url: "https://media.example/en.vtt",
        language: "ENGLISH",
      },
    ],
  );
});

test("should reject thumbnail and storyboard VTT URLs while accepting spoken transcript VTTs", () => {
  assert.equal(
    isStoryboardSubtitleUrl("https://cdn.example/asset/mosaic.vtt"),
    true,
  );

  assert.equal(
    isStoryboardSubtitleUrl("https://cdn.example/asset/thumbnails.vtt?sig=1"),
    true,
  );

  assert.equal(
    isStoryboardSubtitleUrl(
      "https://site.example/media_transcripts/3824457.vtt",
    ),
    false,
  );

  assert.equal(isStoryboardSubtitleUrl("not-a-url"), false);

  assert.equal(
    isSubtitleResourceUrl("https://site.example/media_transcripts/3824457.vtt"),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl("https://training.example/media_transcripts/3824457"),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl(
      "https://training.example/media_transcripts/3824457?locale=pt",
    ),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl("https://training.example/captions/lesson.srt"),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl("https://training.example/captions/lesson.ttml"),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl("https://training.example/captions/lesson.dfxp"),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl("https://training.example/media_transcripts/other"),
    false,
  );

  assert.equal(
    isTranscriptMetadataUrl(
      "https://training.example/media_transcripts/3824457",
    ),
    true,
  );

  assert.equal(
    isTranscriptMetadataUrl(
      "https://training.example/internal_api/media_transcripts/1348709",
    ),
    true,
  );

  assert.equal(
    isSubtitleResourceUrl(
      "https://training.example/internal_api/media_transcripts/1348709",
    ),
    true,
  );

  assert.equal(
    isTranscriptMetadataUrl(
      "https://training.example/internal_api/media_transcripts/other",
    ),
    false,
  );

  assert.equal(
    isTranscriptMetadataUrl(
      "https://training.example/media_transcripts/3824457.vtt",
    ),
    false,
  );

  assert.equal(isTranscriptMetadataUrl("not-a-url"), false);

  assert.equal(
    isSubtitleResourceUrl("https://cdn.example/asset/mosaic.vtt"),
    false,
  );

  assert.equal(
    isSubtitleResourceUrl("https://cdn.example/asset/video.m3u8"),
    false,
  );

  assert.equal(isSubtitleResourceUrl("not-a-url"), false);
});

test("should distinguish spoken WebVTT cues from storyboard sprite coordinates", () => {
  const storyboardVtt = [
    "WEBVTT",
    "",
    "00:00:00.000 --> 00:00:05.000",
    "mosaic.jpg#xywh=0,0,160,90",
    "",
    "00:00:05.000 --> 00:00:10.000",
    "https://cdn.example/sprite.webp#xywh=160,0,160,90",
  ].join("\n");

  const spokenVtt = [
    "WEBVTT",
    "",
    "00:00:00.080 --> 00:00:02.240",
    "Olá pessoal, vamos começar esta aula.",
  ].join("\n");

  assert.equal(hasSpokenSubtitleCues(storyboardVtt), false);
  assert.equal(hasSpokenSubtitleCues("WEBVTT\n\nNOTE no cues here"), false);
  assert.equal(hasSpokenSubtitleCues(spokenVtt), true);
});
