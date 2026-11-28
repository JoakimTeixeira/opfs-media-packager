import { test } from "vitest";
import assert from "node:assert/strict";
import {
  TRACK_DOWNLOAD_MODE_OPTIONS,
  DEFAULT_TRACK_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_PREFERENCES,
  OUTPUT_FORMAT_OPTIONS,
  SEGMENT_CONCURRENCY_OPTIONS,
  trackDownloadModeOrDefault,
  trackQualityPreferenceFromLabel,
  trackQualityPreferenceOrDefault,
  outputFormatOrDefault,
  renderPreferenceOptions,
  subtitleDownloadPreferenceOrDefault,
  type TrackDownloadMode,
} from "./download-preferences.ts";

class FakeOption {
  readonly label: string;
  readonly value: string;

  constructor(label: string, value: string) {
    this.label = label;
    this.value = value;
  }
}

test("should normalize output, course quality, download mode, and subtitle preferences with safe defaults", () => {
  assert.equal(outputFormatOrDefault("mkv"), "mkv");
  assert.equal(outputFormatOrDefault("invalid"), "mp4");
  assert.equal(trackQualityPreferenceOrDefault("smallest"), "smallest");
  assert.equal(trackQualityPreferenceOrDefault("other"), "best");
  assert.equal(subtitleDownloadPreferenceOrDefault("none"), "none");
  assert.equal(subtitleDownloadPreferenceOrDefault("other"), "include");
  const defaultMode: TrackDownloadMode = DEFAULT_TRACK_DOWNLOAD_MODE;

  assert.equal(defaultMode, "all");
  assert.equal(DEFAULT_DOWNLOAD_PREFERENCES.trackDownloadMode, "all");
  assert.equal(trackDownloadModeOrDefault("all"), "all");
  assert.equal(trackDownloadModeOrDefault("videos"), "videos");
  assert.equal(trackDownloadModeOrDefault("documents"), "documents");
  assert.equal(trackDownloadModeOrDefault("invalid"), "all");
  assert.equal(trackDownloadModeOrDefault(null), "all");
  assert.equal(trackQualityPreferenceFromLabel("1080p (1920×1080)"), "1080");
  assert.equal(trackQualityPreferenceFromLabel("720p"), "720");
  assert.equal(trackQualityPreferenceFromLabel("1200 kbps"), "");
});

test("should share stable output, course download mode, and concurrency preferences", () => {
  assert.deepEqual(OUTPUT_FORMAT_OPTIONS, [
    { label: "MP4 + separate subtitle", value: "mp4" },
    { label: "MKV + embedded subtitle", value: "mkv" },
  ]);

  assert.deepEqual(TRACK_DOWNLOAD_MODE_OPTIONS, [
    { label: "Videos + subtitles + companion documents", value: "all" },
    { label: "Videos + subtitles only", value: "videos" },
    {
      label:
        "Companion documents only (Markdown, images, PDFs, diagrams, slides)",
      value: "documents",
    },
  ]);

  assert.equal(SEGMENT_CONCURRENCY_OPTIONS.length, 10);

  assert.deepEqual(SEGMENT_CONCURRENCY_OPTIONS.at(0), {
    label: "1 · most reliable",
    value: "1",
  });

  assert.deepEqual(SEGMENT_CONCURRENCY_OPTIONS.at(-1), {
    label: "10 · fastest",
    value: "10",
  });
});

test("should render the shared preferences into a select", () => {
  const previousOption = globalThis.Option;

  globalThis.Option = FakeOption as unknown as typeof globalThis.Option;

  try {
    const renderedOptions: FakeOption[] = [];

    const select = {
      replaceChildren(...options: FakeOption[]): void {
        renderedOptions.splice(0, renderedOptions.length, ...options);
      },
    };

    renderPreferenceOptions(
      select as unknown as HTMLSelectElement,
      OUTPUT_FORMAT_OPTIONS,
    );

    assert.deepEqual(
      renderedOptions.map(({ label, value }) => ({ label, value })),
      [
        { label: "MP4 + separate subtitle", value: "mp4" },
        { label: "MKV + embedded subtitle", value: "mkv" },
      ],
    );
  } finally {
    globalThis.Option = previousOption;
  }
});
