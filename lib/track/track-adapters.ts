import type { ExternalValue } from "../security/external-values.ts";

type TrackAdapterId = "api-track" | "sidebar-track";

function pageUrl(value: ExternalValue): URL | null {
  if (typeof value !== "string" || !URL.canParse(value)) return null;

  return new URL(value);
}

function isApiTrackPath(page: URL): boolean {
  return /\/courses\//i.test(page.pathname);
}

function isSidebarTrackPath(page: URL): boolean {
  return /^\/c\/[^/]+\/sections\/[^/]+\/lessons\/[^/]+$/i.test(page.pathname);
}

/**
 * Identifies the playlist page structure from its stable route. A page reader
 * is a small module for one structure, so a site's host name never chooses
 * behavior.
 */
export function trackAdapterId(value: ExternalValue): TrackAdapterId | null {
  const page = pageUrl(value);

  if (!page || page.protocol !== "https:") return null;
  if (isApiTrackPath(page)) return "api-track";

  return isSidebarTrackPath(page) ? "sidebar-track" : null;
}

export function isApiTrackPage(value: ExternalValue): boolean {
  return trackAdapterId(value) === "api-track";
}

export function isTrackPage(value: ExternalValue): boolean {
  return trackAdapterId(value) !== null;
}
