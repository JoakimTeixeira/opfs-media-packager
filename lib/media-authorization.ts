import { isPlaylistPage } from "./playlist-adapters.ts";
import { safeMediaUrl } from "./security.ts";

interface AuthorizationHeader {
  readonly header: "referer" | "origin";
  readonly operation: "set";
  readonly value: string;
}

interface AuthorizationAction {
  readonly type: "modifyHeaders";
  readonly requestHeaders: readonly AuthorizationHeader[];
}

interface AuthorizationCondition {
  readonly urlFilter: string;
  readonly resourceTypes: readonly ("xmlhttprequest" | "other")[];
}

interface MediaAuthorizationRule {
  readonly id: number;
  readonly priority: number;
  readonly action: AuthorizationAction;
  readonly condition: AuthorizationCondition;
}

function isQualityDirectory(value: string): boolean {
  const height = Number.parseInt(value, 10);

  return (
    Number.isSafeInteger(height) &&
    height >= 100 &&
    height <= 9999 &&
    value === `${height}p`
  );
}

/** Returns the one media asset directory that can receive the playlist referer. */
function hlsAssetDirectory(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const filename = parts.at(-1);

  if (!filename) return null;
  const qualityDirectory = parts.at(-2);

  const namedMaster =
    filename === "master.m3u8" || filename === "playlist.m3u8";

  const hasQualityDirectory =
    filename.endsWith(".m3u8") &&
    Boolean(qualityDirectory) &&
    isQualityDirectory(qualityDirectory as string);

  if (!namedMaster && !hasQualityDirectory) return null;

  const assetSegments = hasQualityDirectory
    ? parts.slice(0, -2)
    : parts.slice(0, -1);

  return assetSegments.length ? `/${assetSegments.join("/")}` : null;
}

/**
 * Creates a session rule for one selected media asset. The rule preserves the
 * signed-in playlist-page referer only for a recognized playlist route and its
 * matching CDN asset directory.
 */
export function playlistMediaAuthorizationRule(
  mediaUrl: string,
  sourcePageUrl: string,
  extensionId: string,
): MediaAuthorizationRule | null {
  const safeMedia = safeMediaUrl(mediaUrl);
  const safeSource = safeMediaUrl(sourcePageUrl);

  if (!safeMedia || !safeSource || !/^[a-z]{32}$/.test(extensionId)) {
    return null;
  }

  const media = new URL(safeMedia);
  const source = new URL(safeSource);

  if (!isPlaylistPage(source.href)) return null;
  const assetDirectory = hlsAssetDirectory(media.pathname);

  if (!assetDirectory) return null;

  return Object.freeze({
    id: 910001,
    priority: 1,
    action: Object.freeze({
      type: "modifyHeaders" as const,
      requestHeaders: Object.freeze([
        Object.freeze({
          header: "referer" as const,
          operation: "set" as const,
          value: source.href,
        }),
        Object.freeze({
          header: "origin" as const,
          operation: "set" as const,
          value: source.origin,
        }),
      ]),
    }),
    condition: Object.freeze({
      urlFilter: `||${media.hostname}${assetDirectory}/*`,
      resourceTypes: Object.freeze([
        "xmlhttprequest" as const,
        "other" as const,
      ]),
    }),
  });
}
