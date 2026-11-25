import { externalRecord, type ExternalValue } from "./external-values.ts";
import { boundedText, safeMediaUrl } from "./security.ts";
import type { ValidatedSubtitleTrack } from "./extension-messages.ts";

export function knownSubtitleTracksFromPage(
  candidates: ExternalValue,
): readonly ValidatedSubtitleTrack[] {
  if (!Array.isArray(candidates)) return Object.freeze([]);

  return Object.freeze(
    candidates.slice(0, 20).flatMap((candidate): ValidatedSubtitleTrack[] => {
      const record = externalRecord(candidate);

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
