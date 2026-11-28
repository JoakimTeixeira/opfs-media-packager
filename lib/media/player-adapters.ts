import { isApiTrackPage } from "../track/track-adapters.ts";
import type { VideoQualityOption } from "./hls-master.ts";

function isNumericQualityPlaylist(url: string): boolean {
  try {
    return /\/(?:\d{3,4}p\/[^/]+|master)\.m3u8?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function numericQualityMasterUrl(url: string): string {
  const parsed = new URL(url);

  parsed.pathname = parsed.pathname.replace(
    /\/(?:\d{3,4}p\/[^/]+|master)\.m3u8?$/i,
    "/playlist.m3u8",
  );

  return parsed.href;
}

export function masterUrlForDetectedPlaylist(url: string): string | null {
  return isNumericQualityPlaylist(url) ? numericQualityMasterUrl(url) : null;
}

/**
 * Some playlist players authorize an adjacent quality manifest only when the
 * complete item URL is sent as the referrer. Other media uses Chrome's
 * restrictive cross-origin referrer policy.
 */
export function mediaReferrerPolicy(
  mediaUrl: string,
  sourceUrl: string,
): "unsafe-url" | "strict-origin-when-cross-origin" {
  try {
    const media = new URL(mediaUrl);
    const source = new URL(sourceUrl);

    if (isNumericQualityPlaylist(media.href) && isApiTrackPage(source.href)) {
      return "unsafe-url";
    }
  } catch {
    // The normal restrictive policy also covers malformed page URLs.
  }

  return "strict-origin-when-cross-origin";
}

/**
 * Lists numeric quality playlist addresses. The caller checks each address
 * and keeps the qualities available to the signed-in browser session.
 */
export function numericQualityOptions(
  url: string,
): readonly VideoQualityOption[] {
  try {
    const parsed = new URL(url);

    const match = /^(.*)\/(?:\d{3,4}p\/[^/]+|master|playlist)\.m3u8$/i.exec(
      parsed.pathname,
    );

    if (!match) return Object.freeze([]);

    return Object.freeze(
      [1080, 720, 480, 360, 240].map((height) => {
        const candidate = new URL(parsed.href);

        candidate.pathname = `${match[1]}/${height}p/video.m3u8`;

        return Object.freeze({ url: candidate.href, label: `${height}p` });
      }),
    );
  } catch {
    return Object.freeze([]);
  }
}
