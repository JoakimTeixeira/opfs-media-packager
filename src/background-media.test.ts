import { expect, test } from "vitest";
import {
  base64FromBytes,
  bytesFromBase64,
  directQualityOption,
  languageInUrl,
  languageLabel,
  playlistKind,
  playlistMetadata,
  subtitleKind,
  transcriptMetadataFields,
} from "./background-media.ts";

test("should classify safe playlist and subtitle resources", () => {
  expect(playlistKind("https://media.example/video.m3u8?token=1")).toBe(true);
  expect(playlistKind("javascript:alert(1)")).toBe(false);
  expect(subtitleKind("https://media.example/en.vtt")).toBe(true);
  expect(subtitleKind("file:///private.vtt")).toBe(false);
});

test("should resolve subtitle languages and validate transcript metadata", () => {
  expect(languageInUrl("https://media.example/captions/pt-br.vtt")).toBe(
    "Portuguese (Brazil)",
  );

  expect(languageLabel("Subtitle")).toBe("");

  expect(
    transcriptMetadataFields(
      '{"webvtt_file_url":"https://media.example/en.vtt","language":"en"}',
    ),
  ).toEqual({
    resolvedUrl: "https://media.example/en.vtt",
    language: "English",
  });

  expect(transcriptMetadataFields("not json")).toBeNull();
});

test("should round-trip binary bytes and identify a direct quality", () => {
  const bytes = new Uint8Array([0, 1, 255]);

  expect(bytesFromBase64(base64FromBytes(bytes))).toEqual(bytes);

  expect(directQualityOption("https://media.example/720p/video.m3u8")).toEqual({
    url: "https://media.example/720p/video.m3u8",
    label: "720p",
  });

  expect(
    playlistMetadata(
      "#EXTM3U\n#EXT-X-ENDLIST\n",
      "https://media.example/playlist.m3u8",
    ).subtitles,
  ).toEqual([]);
});
