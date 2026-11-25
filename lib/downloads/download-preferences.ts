import { DEFAULT_SEGMENT_CONCURRENCY } from "./segments.ts";
import type { ExternalValue } from "../security/external-values.ts";

export type OutputFormat = "mp4" | "mkv";

export type PlaylistDownloadMode = "all" | "videos" | "documents";

type PlaylistQualityPreference = "best" | "1080" | "720" | "480" | "smallest";

type SubtitleDownloadPreference = "include" | "none";

interface PreferenceOption<T extends string = string> {
  readonly label: string;
  readonly value: T;
}

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "mp4";

export const DEFAULT_PLAYLIST_DOWNLOAD_MODE: PlaylistDownloadMode = "all";

const DEFAULT_PLAYLIST_QUALITY_PREFERENCE: PlaylistQualityPreference = "best";

const DEFAULT_SUBTITLE_DOWNLOAD_PREFERENCE: SubtitleDownloadPreference =
  "include";

export const DEFAULT_DOWNLOAD_PREFERENCES = Object.freeze({
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  playlistQualityPreference: DEFAULT_PLAYLIST_QUALITY_PREFERENCE,
  subtitleDownloadPreference: DEFAULT_SUBTITLE_DOWNLOAD_PREFERENCE,
  playlistDownloadMode: DEFAULT_PLAYLIST_DOWNLOAD_MODE,
  segmentConcurrency: DEFAULT_SEGMENT_CONCURRENCY,
});

export const OUTPUT_FORMAT_OPTIONS: readonly PreferenceOption<OutputFormat>[] =
  Object.freeze([
    Object.freeze({ label: "MP4 + separate subtitle", value: "mp4" as const }),
    Object.freeze({ label: "MKV + embedded subtitle", value: "mkv" as const }),
  ]);

export const PLAYLIST_DOWNLOAD_MODE_OPTIONS: readonly PreferenceOption<PlaylistDownloadMode>[] =
  Object.freeze([
    Object.freeze({
      label: "Videos + subtitles + companion documents",
      value: "all" as const,
    }),
    Object.freeze({
      label: "Videos + subtitles only",
      value: "videos" as const,
    }),
    Object.freeze({
      label:
        "Companion documents only (Markdown, images, PDFs, diagrams, slides)",
      value: "documents" as const,
    }),
  ]);

/** Selects MP4 or MKV from a saved value. Any other value uses the default. */
export function outputFormatOrDefault(value: ExternalValue): OutputFormat {
  return value === "mkv" ? "mkv" : DEFAULT_OUTPUT_FORMAT;
}

const VALID_PLAYLIST_DOWNLOAD_MODES: ReadonlySet<ExternalValue> =
  new Set<PlaylistDownloadMode>(["all", "videos", "documents"]);

/** Selects what a playlist batch download includes from a saved value. */
export function playlistDownloadModeOrDefault(
  value: ExternalValue,
): PlaylistDownloadMode {
  return VALID_PLAYLIST_DOWNLOAD_MODES.has(value)
    ? (value as PlaylistDownloadMode)
    : DEFAULT_PLAYLIST_DOWNLOAD_MODE;
}

const VALID_PLAYLIST_QUALITIES: ReadonlySet<string> =
  new Set<PlaylistQualityPreference>([
    "best",
    "1080",
    "720",
    "480",
    "smallest",
  ]);

/**
 * Selects the quality preference used when downloading every item in a
 * playlist. A quality is the video height such as 720p. "Best" picks the
 * highest quality available for each item.
 */
export function playlistQualityPreferenceOrDefault(
  value: string,
): PlaylistQualityPreference {
  return VALID_PLAYLIST_QUALITIES.has(value)
    ? (value as PlaylistQualityPreference)
    : DEFAULT_PLAYLIST_QUALITY_PREFERENCE;
}

/**
 * Extracts a numeric quality height preference (e.g. "720") from a visible
 * quality dropdown label such as "720p (1280×720)" when updating playlist plans.
 */
export function playlistQualityPreferenceFromLabel(label: string): string {
  const match = /^(\d{3,4})p(?:\b|\s|\(|$)/i.exec(label.trim());

  return match ? match[1] : "";
}

/** Selects whether playlist downloads include a detected subtitle file. */
export function subtitleDownloadPreferenceOrDefault(
  value: string,
): SubtitleDownloadPreference {
  return value === "none" ? "none" : DEFAULT_SUBTITLE_DOWNLOAD_PREFERENCE;
}

const SEGMENT_CONCURRENCY_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    "1": " · most reliable",
    "3": " · default",
    "10": " · fastest",
  });

export const SEGMENT_CONCURRENCY_OPTIONS: readonly PreferenceOption[] =
  Object.freeze(
    Array.from({ length: 10 }, (_, index) => {
      const value = String(index + 1);
      const suffix = SEGMENT_CONCURRENCY_LABELS[value] || "";

      return Object.freeze({ label: `${value}${suffix}`, value });
    }),
  );

/**
 * Renders a reusable download-preference select without duplicating labels or
 * option values across the individual and playlist download pages.
 */
export function renderPreferenceOptions(
  select: HTMLSelectElement,
  options: readonly PreferenceOption[],
): void {
  select.replaceChildren(
    ...options.map(({ label, value }) => new Option(label, value)),
  );
}
