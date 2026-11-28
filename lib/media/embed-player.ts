import {
  externalRecord,
  type ExternalRecord,
  type ExternalValue,
} from "../security/external-values.ts";
import { safeMediaUrl } from "../security/security.ts";
import {
  sortHlsQualityOptions,
  type RawSubtitleTrack,
  type VideoQualityOption,
} from "./hls-master.ts";

export interface EmbedAuthorizationRule {
  readonly id: number;
  readonly priority: number;
  readonly action: {
    readonly type: "modifyHeaders";
    readonly requestHeaders: readonly {
      readonly header: "referer" | "origin";
      readonly operation: "set";
      readonly value: string;
    }[];
  };
  readonly condition: {
    readonly urlFilter: string;
    readonly resourceTypes: readonly ("xmlhttprequest" | "other")[];
  };
}

interface ParsedEmbedPlayerConfig {
  readonly hlsUrl: string;
  readonly progressiveOptions: readonly VideoQualityOption[];
  readonly subtitles: readonly RawSubtitleTrack[];
  readonly title: string;
}

const VIMEO_PLAYER_HOST = /^player\.vimeo\.com$/i;
const VIMEO_PUBLIC_HOST = /^(?:www\.)?vimeo\.com$/i;
const VIMEO_VIDEO_ID = /^\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/i;

function parseSafeHttpsUrl(value: ExternalValue): URL | null {
  const safe = safeMediaUrl(value);

  if (!safe) return null;
  const parsed = new URL(safe);

  return parsed.protocol === "https:" ? parsed : null;
}

/** Normalizes a supported embedded iframe video player URL into canonical HTTPS. */
export function normalizeEmbedPlayerUrl(value: ExternalValue): string | null {
  const parsed = parseSafeHttpsUrl(value);

  if (!parsed) return null;

  if (
    !VIMEO_PLAYER_HOST.test(parsed.hostname) &&
    !VIMEO_PUBLIC_HOST.test(parsed.hostname)
  ) {
    return null;
  }

  const match = VIMEO_VIDEO_ID.exec(parsed.pathname);

  if (!match) return null;

  const target = new URL(`https://player.vimeo.com/video/${match[1]}`);
  const hashParam = parsed.searchParams.get("h") || match[2] || "";
  const appId = parsed.searchParams.get("app_id") || "";

  if (hashParam) target.searchParams.set("h", hashParam);
  if (appId) target.searchParams.set("app_id", appId);

  return target.href;
}

export function isEmbeddedVideoPlayerUrl(value: ExternalValue): boolean {
  return normalizeEmbedPlayerUrl(value) !== null;
}

/** Builds a scoped Referer/Origin rule for an embedded player request. */
export function embedPlayerAuthorizationRule(
  embedUrl: ExternalValue,
  sourcePageUrl: ExternalValue,
  extensionId: string,
  ruleId = 910002,
): EmbedAuthorizationRule | null {
  const normalizedEmbed = normalizeEmbedPlayerUrl(embedUrl);
  const safeSource = parseSafeHttpsUrl(sourcePageUrl);

  if (
    !normalizedEmbed ||
    !safeSource ||
    !/^[a-z]{32}$/.test(extensionId) ||
    !Number.isSafeInteger(ruleId) ||
    ruleId <= 0
  ) {
    return null;
  }

  const embed = new URL(normalizedEmbed);

  return Object.freeze({
    id: ruleId,
    priority: 1,
    action: Object.freeze({
      type: "modifyHeaders" as const,
      requestHeaders: Object.freeze([
        Object.freeze({
          header: "referer" as const,
          operation: "set" as const,
          value: safeSource.href,
        }),
        Object.freeze({
          header: "origin" as const,
          operation: "set" as const,
          value: safeSource.origin,
        }),
      ]),
    }),
    condition: Object.freeze({
      urlFilter: `||${embed.hostname}${embed.pathname}*`,
      resourceTypes: Object.freeze([
        "xmlhttprequest" as const,
        "other" as const,
      ]),
    }),
  });
}

interface BraceScanState {
  index: number;
  depth: number;
  inString: boolean;
  escaped: boolean;
}

function stepStringState(state: BraceScanState, character: string): void {
  if (state.escaped) {
    state.escaped = false;

    return;
  }

  if (character === "\\") {
    state.escaped = true;

    return;
  }

  if (character === '"') state.inString = false;
}

function extractBalancedJsonObject(
  source: string,
  openBraceIndex: number,
): string | null {
  if (source[openBraceIndex] !== "{") return null;

  const state: BraceScanState = {
    index: openBraceIndex,
    depth: 0,
    inString: false,
    escaped: false,
  };

  while (state.index < source.length) {
    const character = source[state.index];

    if (state.inString) {
      stepStringState(state, character);
      state.index += 1;
      continue;
    }

    if (character === '"') state.inString = true;
    if (character === "{") state.depth += 1;
    if (character === "}") state.depth -= 1;

    if (state.depth === 0 && character === "}") {
      return source.slice(openBraceIndex, state.index + 1);
    }

    state.index += 1;
  }

  return null;
}

const CONFIG_MARKER_PATTERNS: readonly RegExp[] = Object.freeze([
  /window\.playerConfig\s*=\s*/i,
  /var\s+config\s*=\s*/i,
  /"request"\s*:\s*\{\s*"files"\s*:/,
]);

function tryParseJsonRecord(snippet: string): ExternalRecord | null {
  try {
    return externalRecord(JSON.parse(snippet));
  } catch {
    return null;
  }
}

function parseConfigRecordFromText(text: string): ExternalRecord | null {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) return tryParseJsonRecord(trimmed);

  for (const pattern of CONFIG_MARKER_PATTERNS) {
    const match = pattern.exec(text);

    if (!match) continue;

    const startIndex =
      pattern === CONFIG_MARKER_PATTERNS[2]
        ? text.lastIndexOf("{", match.index)
        : text.indexOf("{", match.index + match[0].length);

    if (startIndex < 0) continue;

    const snippet = extractBalancedJsonObject(text, startIndex);
    const record = snippet ? tryParseJsonRecord(snippet) : null;

    if (record) return record;
  }

  return null;
}

function resolveOptionalSafeUrl(raw: unknown, baseUrl: string): string {
  if (typeof raw !== "string" || !raw.trim()) return "";

  try {
    return safeMediaUrl(new URL(raw.trim(), baseUrl).href) || "";
  } catch {
    return "";
  }
}

function cdnStreamUrl(entry: unknown, baseUrl: string): string {
  const cdnRecord = externalRecord(entry);

  return (
    resolveOptionalSafeUrl(cdnRecord?.url, baseUrl) ||
    resolveOptionalSafeUrl(cdnRecord?.avc_url, baseUrl)
  );
}

function extractHlsUrlFromFiles(
  filesRecord: ExternalRecord | null,
  baseUrl: string,
): string {
  const hls = externalRecord(filesRecord?.hls);
  const cdns = externalRecord(hls?.cdns);

  if (!cdns) return "";

  const defaultName =
    typeof hls?.default_cdn === "string" ? hls.default_cdn : "";

  const preferred =
    defaultName && defaultName in cdns
      ? cdnStreamUrl(cdns[defaultName], baseUrl)
      : "";

  if (preferred) return preferred;

  for (const entry of Object.values(cdns)) {
    const candidate = cdnStreamUrl(entry, baseUrl);

    if (candidate) return candidate;
  }

  return "";
}

function formatProgressiveLabel(record: ExternalRecord): string {
  const height = typeof record.height === "number" ? record.height : 0;
  const width = typeof record.width === "number" ? record.width : 0;

  if (height > 0 && width > 0) return `${height}p (${width}×${height})`;
  if (height > 0) return `${height}p`;

  return typeof record.quality === "string" ? record.quality.trim() : "";
}

function extractProgressiveOptionsFromFiles(
  filesRecord: ExternalRecord | null,
  baseUrl: string,
): readonly VideoQualityOption[] {
  const rawList = filesRecord?.progressive;

  if (!Array.isArray(rawList)) return Object.freeze([]);

  const options: VideoQualityOption[] = [];
  const seenLabels = new Set<string>();

  for (const entry of rawList) {
    const record = externalRecord(entry);

    if (!record) continue;

    const url = resolveOptionalSafeUrl(record.url, baseUrl);
    const label = formatProgressiveLabel(record);

    if (!url || !label || seenLabels.has(label.toLowerCase())) continue;

    seenLabels.add(label.toLowerCase());
    options.push(Object.freeze({ url, label }));
  }

  return Object.freeze(sortHlsQualityOptions(options));
}

function trimmedStringField(
  record: ExternalRecord,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function parseTextTrackEntry(
  entry: unknown,
  baseUrl: string,
): RawSubtitleTrack | null {
  const record = externalRecord(entry);
  const url = record ? resolveOptionalSafeUrl(record.url, baseUrl) : "";

  if (!record || !url) return null;

  const language = trimmedStringField(record, ["lang", "language"]);
  const label = trimmedStringField(record, ["label"]) || language || "Subtitle";

  return Object.freeze({ url, label, language });
}

function extractTextTracksFromRequest(
  requestRecord: ExternalRecord | null,
  baseUrl: string,
): readonly RawSubtitleTrack[] {
  const rawTracks = requestRecord?.text_tracks;

  if (!Array.isArray(rawTracks)) return Object.freeze([]);

  const seenUrls = new Set<string>();
  const tracks: RawSubtitleTrack[] = [];

  for (const entry of rawTracks) {
    const track = parseTextTrackEntry(entry, baseUrl);

    if (!track || seenUrls.has(track.url)) continue;

    seenUrls.add(track.url);
    tracks.push(track);
  }

  return Object.freeze(tracks);
}

/** Extracts HLS, progressive MP4, subtitle, and title metadata from embed config. */
export function parseEmbedPlayerConfig(
  payloadText: string,
  baseUrl: string,
): ParsedEmbedPlayerConfig | null {
  if (!payloadText.trim()) return null;

  const root = parseConfigRecordFromText(payloadText);

  if (!root) return null;

  const request = externalRecord(root.request);
  const files = externalRecord(request?.files);
  const video = externalRecord(root.video);

  const hlsUrl = extractHlsUrlFromFiles(files, baseUrl);
  const progressiveOptions = extractProgressiveOptionsFromFiles(files, baseUrl);
  const subtitles = extractTextTracksFromRequest(request, baseUrl);
  const title = typeof video?.title === "string" ? video.title.trim() : "";

  if (!hlsUrl && !progressiveOptions.length && !subtitles.length) return null;

  return Object.freeze({
    hlsUrl,
    progressiveOptions,
    subtitles,
    title,
  });
}
