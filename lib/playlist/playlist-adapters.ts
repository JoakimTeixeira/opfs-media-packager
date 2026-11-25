import type { ExternalValue } from "../security/external-values.ts";

type PlaylistAdapterId = "api-playlist" | "sidebar-playlist";

function pageUrl(value: ExternalValue): URL | null {
  if (typeof value !== "string" || !URL.canParse(value)) return null;

  return new URL(value);
}

function isApiPlaylistPath(page: URL): boolean {
  return /\/courses\//i.test(page.pathname);
}

function isSidebarPlaylistPath(page: URL): boolean {
  return /^\/c\/[^/]+\/sections\/[^/]+\/lessons\/[^/]+$/i.test(page.pathname);
}

/**
 * Identifies the playlist page structure from its stable route. A page reader
 * is a small module for one structure, so a site's host name never chooses
 * behavior.
 */
export function playlistAdapterId(
  value: ExternalValue,
): PlaylistAdapterId | null {
  const page = pageUrl(value);

  if (!page || page.protocol !== "https:") return null;
  if (isApiPlaylistPath(page)) return "api-playlist";

  return isSidebarPlaylistPath(page) ? "sidebar-playlist" : null;
}

export function isApiPlaylistPage(value: ExternalValue): boolean {
  return playlistAdapterId(value) === "api-playlist";
}

export function isPlaylistPage(value: ExternalValue): boolean {
  return playlistAdapterId(value) !== null;
}
