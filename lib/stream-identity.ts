/**
 * Returns the stable identity for a stream regardless of whether a player
 * requested its master manifest or one manifest for a specific video quality.
 */
export function streamIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);

    const signedAsset =
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/hls(?:\/|$)/i.exec(
        parsed.pathname,
      );

    if (signedAsset) {
      return `${parsed.origin}/signed-hls/${signedAsset[1].toLowerCase()}`;
    }

    const parts = parsed.pathname.split("/");
    const rawFilename = parts.pop() || "";
    const filename = rawFilename.replace(/([_-]\d+)?\.m3u8?$/i, "");

    if (/^\d{3,4}p$/i.test(parts.at(-1) || "")) parts.pop();

    const identity = /^(?:master|playlist|video)\.m3u8?$/i.test(rawFilename)
      ? ""
      : filename;

    return `${parsed.origin}${parts.join("/")}/${identity}`;
  } catch {
    return null;
  }
}

const DIRECT_VIDEO_EXTENSION_PATTERN = /\.(?:mp4|m4v|webm|mov)$/i;

/**
 * Checks whether a remote HTTP(S) URL points directly to a downloadable video file.
 */
export function isDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }

    return DIRECT_VIDEO_EXTENSION_PATTERN.test(parsed.pathname);
  } catch {
    return false;
  }
}
