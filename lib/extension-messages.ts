import { isApiPlaylistPage, isPlaylistPage } from "./playlist-adapters.ts";
import {
  outputFormatOrDefault,
  type OutputFormat,
} from "./download-preferences.ts";
import {
  externalRecord,
  type ExternalRecord,
  type ExternalValue,
} from "./external-values.ts";
import type { VideoQualityOption } from "./hls-master.ts";
import { boundedText, safeMediaUrl, validTabId } from "./security.ts";

export interface ValidatedSubtitleTrack {
  readonly url: string;
  readonly language: string;
  readonly label: string;
}

export interface ValidatedDownloadRequest {
  readonly url: string;
  readonly selectedQualityUrl: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly sourceTabId: number | null;
  readonly selectedLabel: string;
  readonly qualityOptions: readonly VideoQualityOption[];
  readonly outputFormat: OutputFormat;
  readonly autoStart: boolean;
  readonly subtitle: ValidatedSubtitleTrack | null;
}

function objectRecord(value: ExternalValue): ExternalRecord | null {
  return externalRecord(value);
}

/**
 * Keeps only page-supplied video quality choices that have a safe manifest
 * address. A choice pairs a visible height such as 720p with its HLS manifest.
 */
function availableQualityOptions(
  candidates: ExternalValue,
): readonly VideoQualityOption[] {
  if (!Array.isArray(candidates)) return Object.freeze([]);

  return Object.freeze(
    candidates.slice(0, 10).flatMap((candidate): VideoQualityOption[] => {
      const record = objectRecord(candidate);

      if (!record) return [];
      const url = safeMediaUrl(record.url);
      const label = boundedText(record.label, 80).trim();

      if (!url || !/^\d{3,4}p(?:\s|\(|$)/i.test(label)) return [];

      return [Object.freeze({ url, label })];
    }),
  );
}

export function isTrustedExtensionSender(
  sender: ExternalValue,
  extensionId: string,
  extensionOrigin: string,
): boolean {
  const record = objectRecord(sender);

  if (!record) return false;

  return (
    record.id === extensionId &&
    typeof record.url === "string" &&
    record.url.startsWith(extensionOrigin)
  );
}

export function isTrustedApiPlaylistSender(
  sender: ExternalValue,
  extensionId: string,
): boolean {
  const record = objectRecord(sender);

  if (!record) return false;

  return (
    record.id === extensionId &&
    record.frameId === 0 &&
    isApiPlaylistPage(record.url)
  );
}

export function isTrustedPlaylistSender(
  sender: ExternalValue,
  extensionId: string,
): boolean {
  const record = objectRecord(sender);

  if (!record) return false;
  if (record.id !== extensionId || record.frameId !== 0) return false;

  return isPlaylistPage(record.url);
}

/**
 * Accepts trusted playlist-page frames, including hidden same-origin probe
 * iframes created during headless playlist scanning.
 */
export function isTrustedPlaylistFrameSender(
  sender: ExternalValue,
  extensionId: string,
): boolean {
  const record = objectRecord(sender);

  if (!record) return false;

  if (record.id !== extensionId || !validTabId(record.frameId)) {
    return false;
  }

  return isPlaylistPage(record.url);
}

function validatedRequestSubtitle(
  rawSubtitle: ExternalValue,
): ValidatedSubtitleTrack | null | undefined {
  if (!rawSubtitle) return null;
  const subtitle = objectRecord(rawSubtitle);
  const subtitleUrl = subtitle ? safeMediaUrl(subtitle.url) : null;

  if (!subtitle || !subtitleUrl) return undefined;

  return Object.freeze({
    url: subtitleUrl,
    language: boundedText(subtitle.language, 80),
    label: boundedText(subtitle.label, 160),
  });
}

function validatedSourceTabId(rawTabId: ExternalValue): number | null {
  return validTabId(rawTabId) ? rawTabId : null;
}

/**
 * Validates the short-lived download request passed from the popup to the
 * extension page that owns the download workflow. The request contains data
 * from a web page, so every field is checked before use.
 */
export function validatedDownloadRequest(
  candidate: ExternalValue,
): ValidatedDownloadRequest | null {
  const record = objectRecord(candidate);

  if (!record) return null;
  const url = safeMediaUrl(record.url);

  // The last two properties are read only from saved requests created by
  // earlier releases. New requests always send selectedQualityUrl.
  const selectedQualityUrl = safeMediaUrl(
    record.selectedQualityUrl ||
      record.selectedRendition ||
      record.selectedVariant,
  );

  if (!url || !selectedQualityUrl) return null;
  const subtitle = validatedRequestSubtitle(record.subtitle);

  if (subtitle === undefined) return null;

  return Object.freeze({
    url,
    selectedQualityUrl,
    title: boundedText(record.title, 240),
    sourceUrl: safeMediaUrl(record.sourceUrl) || "",
    sourceTabId: validatedSourceTabId(record.sourceTabId),
    selectedLabel: boundedText(record.selectedLabel, 100),
    // renditions was the former name for the list of video quality choices.
    qualityOptions: availableQualityOptions(
      record.qualityOptions || record.renditions,
    ),
    outputFormat: outputFormatOrDefault(record.outputFormat),
    autoStart: record.autoStart === true,
    subtitle,
  });
}

export function knownSubtitleTracksFromPage(
  candidates: ExternalValue,
): readonly ValidatedSubtitleTrack[] {
  if (!Array.isArray(candidates)) return Object.freeze([]);

  return Object.freeze(
    candidates.slice(0, 20).flatMap((candidate): ValidatedSubtitleTrack[] => {
      const record = objectRecord(candidate);

      if (!record) return [];
      const url = safeMediaUrl(record.url);
      const language = boundedText(record.language, 80).trim();

      if (!url || !language) return [];

      return [
        Object.freeze({
          url,
          language,
          label: boundedText(record.label, 160),
        }),
      ];
    }),
  );
}
