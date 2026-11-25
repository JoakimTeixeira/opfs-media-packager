export interface SubtitleTrackCandidate {
  readonly url?: string;
  readonly language?: string;
  readonly label?: string;
}

export interface KnownSubtitleTrack {
  readonly url: string;
  readonly language: string;
  readonly label?: string;
}

const SUBTITLE_EXTENSION_PATTERN = /\.(?:vtt|srt|ttml|dfxp)$/i;

const TRANSCRIPT_METADATA_PATTERN =
  /^(?:\/internal_api)?\/media_transcripts\/\d+$/i;

const STORYBOARD_PATH_PATTERN =
  /(?:^|[/_-])(?:mosaic|storyboard|thumbnails?|thumbs?|sprites?|preview)(?:[._/-]|$)/i;

const CUE_TIMING_PATTERN = /\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->/;

const STORYBOARD_CUE_LINE_PATTERN =
  /(?:#xywh=\d+,\d+,\d+,\d+|\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$))/i;

/**
 * Returns true when a URL pathname looks like a video thumbnail/storyboard
 * sprite map (such as `mosaic.vtt`) rather than spoken captions.
 */
export function isStoryboardSubtitleUrl(url: string): boolean {
  try {
    return STORYBOARD_PATH_PATTERN.test(
      decodeURIComponent(new URL(url).pathname),
    );
  } catch {
    return false;
  }
}

/**
 * Returns true when a URL pathname points to an explicit numeric transcript
 * metadata/resource endpoint (`/media_transcripts/<id>` without extension).
 */
export function isTranscriptMetadataUrl(url: string): boolean {
  try {
    return TRANSCRIPT_METADATA_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Returns true when a URL points to a supported subtitle file extension or an
 * explicit transcript endpoint and is not a thumbnail/storyboard preview VTT.
 */
export function isSubtitleResourceUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;

    return (
      !isStoryboardSubtitleUrl(url) &&
      (SUBTITLE_EXTENSION_PATTERN.test(pathname) ||
        TRANSCRIPT_METADATA_PATTERN.test(pathname))
    );
  } catch {
    return false;
  }
}

/**
 * Returns true when WebVTT/SRT text contains at least one cue block with
 * spoken text rather than thumbnail sprite coordinates (such as `#xywh=`).
 */
export function hasSpokenSubtitleCues(text: string): boolean {
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/^WEBVTT[^\n]*\r?\n?/i, "")
    .split(/\r?\n\r?\n+/);

  return blocks.some((block) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const timingIndex = lines.findIndex((line) =>
      CUE_TIMING_PATTERN.test(line),
    );

    if (timingIndex < 0) return false;

    const payloadLines = lines.slice(timingIndex + 1);

    return payloadLines.some((line) => !STORYBOARD_CUE_LINE_PATTERN.test(line));
  });
}

/**
 * Keeps one usable subtitle per human-readable language.
 *
 * The same track is commonly observed twice: once in the master HLS manifest
 * and once as the player's direct VTT request. Their URLs can differ, so URL
 * based deduplication alone still produces duplicate menu entries.
 */
export function uniqueKnownSubtitleTracks(
  ...groups: readonly (readonly SubtitleTrackCandidate[] | null | undefined)[]
): KnownSubtitleTrack[] {
  const tracks = new Map<string, KnownSubtitleTrack>();

  for (const group of groups) {
    for (const item of group || []) {
      const language = item.language?.trim();
      const url = item.url?.trim();

      if (!language || !url) continue;
      const key = language.toLocaleLowerCase();

      if (!tracks.has(key)) tracks.set(key, { ...item, language, url });
    }
  }

  return [...tracks.values()];
}
