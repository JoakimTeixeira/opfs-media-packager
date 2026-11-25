export type RemuxErrorKind =
  "rate-limited" | "unauthorized" | "engine" | "item";

interface FfmpegConversionProgress {
  readonly phase: "remux" | "faststart";
  readonly percent: number | null;
}

export const OPFS_JOB_PREFIX = "hls-remux-";
export const OPFS_RESUME_PREFIX = "hls-resume-";
export const CHECKPOINT_PART_SEGMENTS = 100;

export interface OpfsCheckpointPart {
  readonly name: string;
  readonly segments: number;
  readonly bytes: number;
}

export interface OpfsResumeCheckpoint {
  readonly totalSegments: number;
  readonly completedSegments: number;
  readonly updatedAt: number;
  readonly parts: readonly OpfsCheckpointPart[];
}

const TIME_PATTERN = /\btime=(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)\b/;

/**
 * Formats an FFmpeg concat demuxer manifest for ordered MPEG-TS part files.
 */
export function buildConcatManifest(partPaths: readonly string[]): string {
  return partPaths.map((part) => `file '${part}'`).join("\n");
}

/**
 * Splits streamed segments into a new OPFS part file only when a discontinuity
 * boundary occurs after at least one segment has already been written.
 */
export function shouldSplitDiscontinuityPart(
  hasDiscontinuity: boolean,
  segmentIndex: number,
): boolean {
  return hasDiscontinuity && segmentIndex > 0;
}

/**
 * Identifies orphaned temporary OPFS job directories left behind by earlier
 * closed or interrupted tabs while preserving the active job directory.
 */
export function staleOpfsJobNames(
  entryNames: readonly string[],
  activeJobDir: string | null,
): string[] {
  return entryNames.filter(
    (name) => name.startsWith(OPFS_JOB_PREFIX) && name !== activeJobDir,
  );
}

/**
 * Parses FFmpeg stderr progress and faststart pass lines so large remuxes show
 * live status instead of appearing frozen at 100%.
 */
export function parseFfmpegProgressLine(
  line: string,
  totalDurationSeconds: number,
): FfmpegConversionProgress | null {
  if (/starting second pass|moving the moov atom/i.test(line)) {
    return Object.freeze({ phase: "faststart", percent: null });
  }

  const match = TIME_PATTERN.exec(line);

  if (!match) return null;

  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) {
    return Object.freeze({ phase: "remux", percent: null });
  }

  const elapsedSeconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);

  const percent = Math.max(
    0,
    Math.min(99, Math.floor((elapsedSeconds / totalDurationSeconds) * 100)),
  );

  return Object.freeze({ phase: "remux", percent });
}

/**
 * Maps a download or remux failure message to the queue policy failure kind.
 */
export function classifyRemuxErrorKind(errorText: string): RemuxErrorKind {
  if (/HTTP (?:429|503)\b/i.test(errorText)) return "rate-limited";
  if (/HTTP (?:401|403)\b/i.test(errorText)) return "unauthorized";

  if (
    /MP4 engine|FFmpeg|prepare the requested download|Array buffer allocation|out of memory|OOM|WebAssembly|quota|storage|OPFS/i.test(
      errorText,
    )
  ) {
    return "engine";
  }

  return "item";
}

const TRANSIENT_RETRY_BACKOFF_MS: readonly number[] = Object.freeze([
  750, 1500, 3000, 5000, 8000,
]);

const PART_FILENAME_PATTERN = /^part-\d{6}\.ts$/;

/**
 * Picks how many sequential segments to bundle into each OPFS part file so
 * long multi-thousand-segment videos checkpoint frequently without exceeding
 * open file handle limits.
 */
export function checkpointPartSize(totalSegments: number): number {
  return Math.max(
    CHECKPOINT_PART_SEGMENTS,
    Math.ceil(Math.max(1, totalSegments) / 40),
  );
}

function fnv1aPairHex(input: string): string {
  const hashState = { h1: 0x811c9dc5, h2: 0x6b2f1a7c, index: 0 };

  for (const character of input) {
    const code = character.charCodeAt(0);

    hashState.h1 = Math.imul(hashState.h1 ^ code, 0x01000193) >>> 0;

    hashState.h2 =
      Math.imul(hashState.h2 ^ (code + hashState.index), 0x01000193) >>> 0;

    hashState.index += 1;
  }

  return (
    hashState.h1.toString(16).padStart(8, "0") +
    hashState.h2.toString(16).padStart(8, "0")
  );
}

/**
 * Derives a deterministic OPFS resume directory key from a media manifest URL
 * and segment count while stripping signed URL tokens and query parameters.
 */
export function canonicalResumeStreamKey(
  playlistUrl: string,
  totalSegments: number,
): string {
  try {
    const parsed = new URL(playlistUrl);

    const stablePath = parsed.pathname
      .split("/")
      .filter((segment) => Boolean(segment) && !segment.includes("="))
      .join("/");

    return `${OPFS_RESUME_PREFIX}${fnv1aPairHex(`${parsed.origin}/${stablePath}|${totalSegments}`)}`;
  } catch {
    return `${OPFS_RESUME_PREFIX}${fnv1aPairHex(`${playlistUrl}|${totalSegments}`)}`;
  }
}

/**
 * Parses an HTTP Retry-After header (seconds or HTTP-date) and clamps it to a
 * bounded polling delay.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  fallbackMs: number,
  maxMs = 6000,
  nowMs = Date.now(),
): number {
  const raw = headerValue?.trim();

  if (!raw) return fallbackMs;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.max(250, Math.min(maxMs, Math.round(Number(raw) * 1000)));
  }

  const targetMs = Date.parse(raw);

  if (Number.isFinite(targetMs)) {
    return Math.max(250, Math.min(maxMs, targetMs - nowMs));
  }

  return fallbackMs;
}

/**
 * Computes the bounded retry backoff delay for transient segment network
 * errors or temporary rate-limit (HTTP 429 / 503) responses.
 */
export function segmentRetryDelayMs(
  attempt: number,
  status?: number,
  retryAfterHeader?: string | null,
): number {
  if (status === 429 || status === 503) {
    return parseRetryAfterMs(
      retryAfterHeader,
      attempt <= 1 ? 1500 : 3500,
      6000,
    );
  }

  const index = Math.min(
    Math.max(Math.trunc(attempt) - 1, 0),
    TRANSIENT_RETRY_BACKOFF_MS.length - 1,
  );

  return TRANSIENT_RETRY_BACKOFF_MS[index];
}

/**
 * Reduces parallel segment concurrency after a transient rate-limit or timeout
 * backoff while never dropping below 1 request at a time.
 */
export function nextAdaptiveConcurrency(
  current: number,
  hitBackoff: boolean,
): number {
  return hitBackoff ? Math.max(1, Math.floor(current / 2)) : current;
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseValidatedPart(
  rawPart: unknown,
  existingFileSizes: ReadonlyMap<string, number>,
): OpfsCheckpointPart | null {
  if (typeof rawPart !== "object" || rawPart === null) return null;
  const candidate = rawPart as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const segments = candidate.segments;
  const bytes = candidate.bytes;

  if (!PART_FILENAME_PATTERN.test(name)) return null;
  if (!isPositiveSafeInt(segments) || !isPositiveSafeInt(bytes)) return null;
  if (existingFileSizes.get(name) !== bytes) return null;

  return Object.freeze({ name, segments, bytes });
}

function hasValidCheckpointBounds(
  record: Record<string, unknown>,
  expectedTotalSegments: number,
): boolean {
  const completed = record.completedSegments;

  return (
    record.totalSegments === expectedTotalSegments &&
    isPositiveSafeInt(completed) &&
    completed <= expectedTotalSegments &&
    Array.isArray(record.parts) &&
    record.parts.length > 0
  );
}

/**
 * Verifies an OPFS checkpoint descriptor against the actual sealed part files
 * on disk so corrupted or incomplete checkpoints never produce a broken remux.
 */
export function validateResumeCheckpoint(
  raw: unknown,
  expectedTotalSegments: number,
  existingFileSizes: ReadonlyMap<string, number>,
): OpfsResumeCheckpoint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  if (!hasValidCheckpointBounds(record, expectedTotalSegments)) return null;
  const completed = record.completedSegments as number;
  const rawParts = record.parts as unknown[];
  const parts: OpfsCheckpointPart[] = [];

  for (const rawPart of rawParts) {
    const validated = parseValidatedPart(rawPart, existingFileSizes);

    if (!validated) return null;
    parts.push(validated);
  }

  const summedSegments = parts.reduce((sum, part) => sum + part.segments, 0);

  if (summedSegments !== completed) return null;

  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;

  return Object.freeze({
    totalSegments: expectedTotalSegments,
    completedSegments: completed,
    updatedAt,
    parts: Object.freeze(parts),
  });
}

/**
 * Selects expired or excess OPFS resume directories while preserving the most
 * recent valid checkpoints up to `maxRetained` and any active job directory.
 */
export function expiredResumeJobNames(
  entries: readonly { readonly name: string; readonly updatedAt: number }[],
  activeJobDir: string | null,
  nowMs: number,
  maxAgeMs = 86_400_000,
  maxRetained = 2,
): string[] {
  const candidates = entries
    .filter(
      (entry) =>
        entry.name.startsWith(OPFS_RESUME_PREFIX) &&
        entry.name !== activeJobDir,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  const expired: string[] = [];
  const retainedState = { kept: 0 };

  for (const entry of candidates) {
    const isExpired = nowMs - entry.updatedAt > maxAgeMs;

    if (isExpired || retainedState.kept >= maxRetained) {
      expired.push(entry.name);
      continue;
    }

    retainedState.kept += 1;
  }

  return expired;
}
