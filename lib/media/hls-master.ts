export interface VideoQualityOption {
  readonly url: string;
  readonly label: string;
  readonly audioUri?: string;
}

export interface RawSubtitleTrack {
  readonly url: string;
  readonly label: string;
  readonly language: string;
}

export interface HlsMasterMetadata {
  readonly isMaster: boolean;
  readonly qualityOptions: readonly VideoQualityOption[];
  readonly subtitles: readonly RawSubtitleTrack[];
}

interface AudioGroupCandidate {
  readonly uri: string;
  readonly score: number;
}

export function parseHlsAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const match of source.matchAll(/([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/g)) {
    attributes[match[1]] = match[2].replace(/^"|"$/g, "");
  }

  return attributes;
}

export function qualityOptionKey(option: {
  readonly label?: string;
  readonly url?: string;
}): string {
  const label = (option.label || "").trim().toLowerCase();
  const height = /^(\d{3,4}p)\b/.exec(label);

  return height ? height[1] : label || option.url || "";
}

export function sortHlsQualityOptions<T extends { readonly label: string }>(
  qualityOptions: readonly T[],
): T[] {
  return [...qualityOptions].sort(
    (left, right) =>
      Number.parseInt(right.label, 10) - Number.parseInt(left.label, 10),
  );
}

/**
 * Collects the preferred audio rendition URI per `#EXT-X-MEDIA:TYPE=AUDIO`
 * `GROUP-ID`, preferring `DEFAULT=YES`, then `AUTOSELECT=YES`, then highest
 * listed entry.
 */
export function parseHlsAudioGroups(
  lines: readonly string[],
  baseUrl: string,
): ReadonlyMap<string, string> {
  const bestByGroup = new Map<string, AudioGroupCandidate>();

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line.startsWith("#EXT-X-MEDIA:")) continue;

    const attrs = parseHlsAttributes(line.slice(13));

    if (attrs.TYPE !== "AUDIO" || !attrs.URI || !attrs["GROUP-ID"]) continue;

    const groupId = attrs["GROUP-ID"];
    const uri = new URL(attrs.URI, baseUrl).href;

    const score =
      (attrs.DEFAULT === "YES" ? 4 : 0) +
      (attrs.AUTOSELECT === "YES" ? 2 : 0) +
      1;

    const current = bestByGroup.get(groupId);

    if (!current || score > current.score) {
      bestByGroup.set(groupId, { uri, score });
    }
  }

  return new Map(
    [...bestByGroup.entries()].map(([groupId, entry]) => [groupId, entry.uri]),
  );
}

function parseStreamInfEntry(
  lines: readonly string[],
  index: number,
  baseUrl: string,
  audioGroups: ReadonlyMap<string, string>,
): VideoQualityOption | null {
  const attrs = parseHlsAttributes(lines[index].slice(18));

  const uri = lines
    .slice(index + 1)
    .find((line) => line && !line.startsWith("#"));

  if (!uri) return null;
  const [width, height] = (attrs.RESOLUTION || "0x0").split("x").map(Number);
  const audioUri = attrs.AUDIO ? audioGroups.get(attrs.AUDIO) : undefined;

  return {
    url: new URL(uri, baseUrl).href,
    label: height
      ? `${height}p (${width}×${height})`
      : `${Math.round(Number(attrs.BANDWIDTH || 0) / 1000)} kbps`,
    ...(audioUri ? { audioUri } : {}),
  };
}

function parseSubtitleMediaEntry(
  line: string,
  baseUrl: string,
): RawSubtitleTrack | null {
  const attrs = parseHlsAttributes(line.slice(13));

  if (attrs.TYPE !== "SUBTITLES" || !attrs.URI) return null;

  return {
    url: new URL(attrs.URI, baseUrl).href,
    label: attrs.NAME || attrs.LANGUAGE || "Subtitle",
    language: attrs.LANGUAGE || attrs.NAME || "",
  };
}

/**
 * Parses video quality choices and declared subtitle tracks in an HLS master
 * playlist. HLS calls each quality choice a variant. The returned subtitle
 * `language` is intentionally raw so the caller can map it to the language
 * labels used by its interface.
 */
export function parseHlsMaster(
  text: string,
  baseUrl: string,
): HlsMasterMetadata {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  const audioGroups = parseHlsAudioGroups(lines, baseUrl);
  const qualityOptions: VideoQualityOption[] = [];
  const subtitles: RawSubtitleTrack[] = [];

  for (const [index, line] of lines.entries()) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const option = parseStreamInfEntry(lines, index, baseUrl, audioGroups);

      if (
        option &&
        !qualityOptions.some(
          (existing) => qualityOptionKey(existing) === qualityOptionKey(option),
        )
      ) {
        qualityOptions.push(option);
      }
    }

    if (line.startsWith("#EXT-X-MEDIA:")) {
      const subtitle = parseSubtitleMediaEntry(line, baseUrl);

      if (subtitle) subtitles.push(subtitle);
    }
  }

  return Object.freeze({
    isMaster: qualityOptions.length > 0,
    qualityOptions: Object.freeze(sortHlsQualityOptions(qualityOptions)),
    subtitles: Object.freeze([...subtitles]),
  });
}
