import {
  parseHlsAttributes,
  qualityOptionKey,
  sortHlsQualityOptions,
} from "../lib/media/hls-master.ts";

export interface ByteRange {
  readonly start: number;
  readonly end: number;
  readonly header: string;
}

export interface MediaMap {
  readonly uri: string;
  readonly range: ByteRange | null;
}

export interface MediaSegment {
  readonly uri: string;
  readonly range: ByteRange | null;
  readonly sequence?: number;
  readonly discontinuity?: boolean;
}

export interface AnalyzedQualityOption {
  readonly uri: string;
  readonly label: string;
  readonly bandwidth: number;
  readonly codecs: string;
}

export interface MasterPlaylistAnalysis {
  readonly type: "master";
  readonly qualityOptions: AnalyzedQualityOption[];
}

export interface MediaPlaylistAnalysis {
  readonly type: "media";
  readonly segments: MediaSegment[];
  readonly map: MediaMap | null;
  readonly complete: boolean;
  readonly totalDurationSeconds: number;
}

type PlaylistAnalysis = MasterPlaylistAnalysis | MediaPlaylistAnalysis;

function parseAttributes(source: string): Record<string, string> {
  return parseHlsAttributes(source);
}

function resolveUri(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).href;
}

function parseByteRange(value: string, previous: ByteRange | null): ByteRange {
  const [lengthPart, offsetPart] = value.split("@");
  const length = Number(lengthPart);

  const offset =
    offsetPart === undefined ? (previous?.end ?? 0) : Number(offsetPart);

  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(offset)) {
    throw new Error(`Invalid byte range: ${value}`);
  }

  return {
    start: offset,
    end: offset + length,
    header: `bytes=${offset}-${offset + length - 1}`,
  };
}

function nextUri(
  lines: readonly string[],
  startingAt: number,
): { readonly value: string; readonly index: number } {
  const offset = lines.slice(startingAt).findIndex((raw) => {
    const trimmed = raw.trim();

    return Boolean(trimmed) && !trimmed.startsWith("#");
  });

  if (offset < 0) throw new Error("A manifest tag is missing its URI.");
  const index = startingAt + offset;

  return { value: lines[index].trim(), index };
}

function parseMasterQualityOptions(
  lines: readonly string[],
  baseUrl: string,
): AnalyzedQualityOption[] {
  const qualityOptions: AnalyzedQualityOption[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();

    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const attrs = parseAttributes(line.slice("#EXT-X-STREAM-INF:".length));
    const next = nextUri(lines, index + 1);
    const [width, height] = (attrs.RESOLUTION || "0x0").split("x").map(Number);

    const candidate: AnalyzedQualityOption = {
      uri: resolveUri(next.value, baseUrl),
      label: height
        ? `${height}p (${width}×${height})`
        : `${Math.round(Number(attrs.BANDWIDTH || 0) / 1000)} kbps`,
      bandwidth: Number(attrs.BANDWIDTH || 0),
      codecs: attrs.CODECS || "unknown codec",
    };

    if (
      !qualityOptions.some(
        (existing) =>
          qualityOptionKey(existing) === qualityOptionKey(candidate),
      )
    ) {
      qualityOptions.push(candidate);
    }
  }

  return qualityOptions;
}

interface MediaParseState {
  map: MediaMap | null;
  pendingRange: ByteRange | null;
  previousRange: ByteRange | null;
  pendingDiscontinuity: boolean;
  totalDurationSeconds: number;
  sequence: number;
}

function applyMediaLine(
  line: string,
  baseUrl: string,
  mediaState: MediaParseState,
  segments: MediaSegment[],
): void {
  if (line.startsWith("#EXT-X-KEY:")) {
    const key = parseAttributes(line.slice("#EXT-X-KEY:".length));

    if (key.METHOD && key.METHOD !== "NONE") {
      throw new Error(`Encrypted manifest (${key.METHOD}) is not supported.`);
    }

    return;
  }

  if (line.startsWith("#EXT-X-MAP:")) {
    const attrs = parseAttributes(line.slice("#EXT-X-MAP:".length));

    mediaState.map = {
      uri: resolveUri(attrs.URI, baseUrl),
      range: attrs.BYTERANGE
        ? parseByteRange(attrs.BYTERANGE, mediaState.previousRange)
        : null,
    };

    return;
  }

  if (line.startsWith("#EXT-X-BYTERANGE:")) {
    mediaState.pendingRange = parseByteRange(
      line.slice("#EXT-X-BYTERANGE:".length),
      mediaState.previousRange,
    );

    return;
  }

  if (line === "#EXT-X-DISCONTINUITY") {
    mediaState.pendingDiscontinuity = true;

    return;
  }

  if (line.startsWith("#EXTINF:")) {
    const duration = Number.parseFloat(line.slice("#EXTINF:".length));

    if (Number.isFinite(duration) && duration > 0) {
      mediaState.totalDurationSeconds += duration;
    }

    return;
  }

  if (line.startsWith("#")) return;
  mediaState.sequence += 1;

  segments.push({
    uri: resolveUri(line, baseUrl),
    range: mediaState.pendingRange,
    sequence: mediaState.sequence,
    ...(mediaState.pendingDiscontinuity ? { discontinuity: true } : {}),
  });

  mediaState.previousRange = mediaState.pendingRange;
  mediaState.pendingRange = null;
  mediaState.pendingDiscontinuity = false;
}

export function parsePlaylist(text: string, baseUrl: string): PlaylistAnalysis {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  if (lines[0]?.trim() !== "#EXTM3U") {
    throw new Error("The URL did not return an HLS manifest.");
  }

  const qualityOptions = parseMasterQualityOptions(lines, baseUrl);

  if (qualityOptions.length) {
    return {
      type: "master",
      qualityOptions: sortHlsQualityOptions(qualityOptions),
    };
  }

  const segments: MediaSegment[] = [];

  const mediaState: MediaParseState = {
    map: null,
    pendingRange: null,
    previousRange: null,
    pendingDiscontinuity: false,
    totalDurationSeconds: 0,
    sequence: 0,
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line) applyMediaLine(line, baseUrl, mediaState, segments);
  }

  if (!segments.length) {
    throw new Error("No media segments were found in this playlist.");
  }

  return {
    type: "media",
    segments,
    map: mediaState.map,
    complete: lines.some((line) => line.trim() === "#EXT-X-ENDLIST"),
    totalDurationSeconds: mediaState.totalDurationSeconds,
  };
}
