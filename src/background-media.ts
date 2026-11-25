import { externalRecord } from "../lib/security/external-values.ts";
import { safeMediaUrl } from "../lib/security/security.ts";
import { isSubtitleResourceUrl } from "../lib/subtitles/subtitle-tracks.ts";
import {
  parseHlsMaster,
  type HlsMasterMetadata,
  type VideoQualityOption,
} from "../lib/media/hls-master.ts";

export function playlistKind(url: string): boolean {
  try {
    return (
      Boolean(safeMediaUrl(url)) && /\.m3u8?$/i.test(new URL(url).pathname)
    );
  } catch {
    return false;
  }
}

export function subtitleKind(url: string): boolean {
  return Boolean(safeMediaUrl(url)) && isSubtitleResourceUrl(url);
}

function isGenericSubtitleLabel(value: string): boolean {
  return (
    !value ||
    /^(?:subtitle|subtitles|caption|captions|legenda|legendas|cc|track|default|unknown|und)$/i.test(
      String(value).trim(),
    )
  );
}

export function languageLabel(code: string): string {
  if (!code || isGenericSubtitleLabel(code)) return "";
  const languageTag = code.toLowerCase().replace("_", "-").trim();

  const names: Readonly<Record<string, string>> = {
    pt: "Portuguese",
    "pt-br": "Portuguese (Brazil)",
    "pt-pt": "Portuguese (Portugal)",
    en: "English",
    "en-us": "English (US)",
    "en-gb": "English (UK)",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    "zh-cn": "Chinese (Simplified)",
    "zh-tw": "Chinese (Traditional)",
  };

  return names[languageTag] || languageInName(code) || code;
}

export function languageInUrl(url: string): string {
  const text = decodeURIComponent(new URL(url).pathname).toLowerCase();

  const match = text.match(
    /(?:^|[._/-])(pt-br|pt-pt|en-us|en-gb|zh-cn|zh-tw|pt|en|es|fr|de|it|ja|ko|zh)(?:[._/-]|$)/,
  );

  return match ? languageLabel(match[1]) : "";
}

export function languageInName(name: string): string {
  const value = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const names: readonly (readonly [string, string])[] = [
    ["portuguese", "Portuguese"],
    ["portugues", "Portuguese"],
    ["english", "English"],
    ["ingles", "English"],
    ["spanish", "Spanish"],
    ["espanol", "Spanish"],
    ["espanhol", "Spanish"],
    ["french", "French"],
    ["francais", "French"],
    ["frances", "French"],
    ["german", "German"],
    ["deutsch", "German"],
    ["alemao", "German"],
    ["italian", "Italian"],
    ["italiano", "Italian"],
    ["japanese", "Japanese"],
    ["korean", "Korean"],
    ["chinese", "Chinese"],
  ];

  return names.find(([needle]) => value.includes(needle))?.[1] || "";
}

export function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64FromBytes(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];

  for (
    const cursor = { offset: 0 };
    cursor.offset < bytes.length;
    cursor.offset += chunkSize
  ) {
    parts.push(
      String.fromCharCode(
        ...bytes.subarray(cursor.offset, cursor.offset + chunkSize),
      ),
    );
  }

  return btoa(parts.join(""));
}

export function transcriptMetadataFields(content: string): {
  readonly resolvedUrl: string | null;
  readonly language: string;
} | null {
  try {
    const record = externalRecord(JSON.parse(content));

    if (!record) return null;

    const candidateUrl =
      record.webvtt_file_url ??
      record.vtt_url ??
      record.subtitle_url ??
      record.captions_url ??
      record.transcript_url ??
      record.url;

    const resolvedUrl = safeMediaUrl(candidateUrl);

    const rawLang =
      [record.language, record.locale, record.lang, record.srclang].find(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      ) || "";

    return {
      resolvedUrl,
      language: languageLabel(rawLang) || languageInName(rawLang),
    };
  } catch {
    return null;
  }
}

export /** Creates a selectable quality option when a player requested one quality. */
function directQualityOption(url: string): VideoQualityOption | null {
  const parsed = new URL(url);
  const qualityPathSegment = parsed.pathname.split("/").at(-2) || "";
  const match = qualityPathSegment.match(/^(\d{3,4})p$/i);

  return match ? { url, label: `${match[1]}p` } : null;
}

export /**
 * Players can request /1080p/video.m3u8 even when an adjacent master manifest
 * lists every available video quality.
 */
function playlistMetadata(text: string, baseUrl: string): HlsMasterMetadata {
  const master = parseHlsMaster(text, baseUrl);

  return {
    ...master,
    subtitles: master.subtitles
      .map((track) => ({
        ...track,
        language: languageLabel(track.language) || languageInName(track.label),
      }))
      .filter((track) => track.language),
  };
}
