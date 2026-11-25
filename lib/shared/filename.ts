import {
  DEFAULT_OUTPUT_FORMAT,
  type OutputFormat,
} from "../downloads/download-preferences.ts";

/**
 * Converts a detected media title to a Windows-safe filename stem.
 * Emoji/icons are removed; `:` and `|` become readable separators.
 */
export function sanitizeFilenameStem(value: string): string {
  return (
    value
      // Unicode NFKC makes equivalent characters use one consistent form.
      .normalize("NFKC")
      .replace(
        /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu,
        "",
      )
      .replace(/[:|–—]/g, " - ")
      .replace(/[,;]/g, " ")
      .replace(/[<>"/\\?*\p{Cc}]/gu, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*-\s*/g, " - ")
      .replace(/(?: - ){2,}/g, " - ")
      // A title made only of removed icons/separators must not become `- -`.
      .replace(/^[.\s-]+|[.\s-]+$/g, "")
      .slice(0, 116) || "video"
  );
}

export function mediaFilename(title: string, extension: OutputFormat): string {
  return `${sanitizeFilenameStem(title.replace(/\.(mp4|mkv)$/i, ""))}.${extension}`;
}

export function videoFilename(title: string): string {
  return mediaFilename(title, DEFAULT_OUTPUT_FORMAT);
}

export function subtitleFilename(
  videoName: string,
  subtitleUrl: string,
): string {
  const extension =
    /\.(vtt|srt)$/i.exec(new URL(subtitleUrl).pathname)?.[1]?.toLowerCase() ||
    "vtt";

  return `${videoName.replace(/\.(mp4|mkv)$/i, "")}.${extension}`;
}
