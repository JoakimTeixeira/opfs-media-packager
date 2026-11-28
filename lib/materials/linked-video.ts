const EXCLUDED_EXTERNAL_VIDEO_HOST_PATTERN =
  /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

const LINKED_VIDEO_HOST_PATTERN =
  /(?:^|\.)(?:vimeo\.com|loom\.com|mediadelivery\.net|wistia\.com|wistia\.net|cloudflarestream\.com|videodelivery\.net|mux\.com|jwplayer\.com|vidyard\.com|sproutvideo\.com|brightcove\.net|vzaar\.com)$|^(?:player|embed|stream|video)\./i;

const LINKED_STATIC_ASSET_PATTERN =
  /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|css|js|mjs|woff2?|ttf|eot|otf|pdf|zip|rar|7z|tar|gz|json|xml|txt|md|csv|docx?|xlsx?|pptx?)(?:[?#]|$)/i;

const LINKED_NON_VIDEO_PATH_PATTERN =
  /(?:^|\/)(?:settings|profile|account|members|notifications|messages|chat|checkout|billing|pricing|sign[_-]?in|sign[_-]?up|login|logout|auth|session|certificate|certificado|leaderboard|dashboard|referrals|indicacoes|thumbnail|thumbnails|avatar|avatars)(?:\/|$|\?)/i;

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split(".");

  if (parts.length < 2) return "";

  const take =
    parts.at(-1)?.length === 2 && (parts.at(-2)?.length || 0) <= 3 ? 3 : 2;

  return parts.slice(-take).join(".");
}

/** Checks whether two hostnames share the same registrable site domain. */
export function isSameSiteHost(hostA: string, hostB: string): boolean {
  const rootA = registrableDomain(hostA);

  return Boolean(rootA) && rootA === registrableDomain(hostB);
}

function parseHttpsUrl(value: string, base?: string): URL | null {
  try {
    const parsed = base ? new URL(value, base) : new URL(value);

    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function scoreSameSiteLinkedPath(pathname: string): number {
  if (/^\/c\/[^/]+\/sections\/[^/]+\/lessons\/[^/]+/i.test(pathname)) return 30;
  if (/^\/c\/[^/]+\/(?!sections\/?$)[^/]+/i.test(pathname)) return 25;

  if (
    /^\/(?:courses|posts|videos|watch|aulas|meetups|lives)\//i.test(pathname)
  ) {
    return 18;
  }

  return 0;
}

/**
 * Scores a candidate URL linked from an item body to rank likely video posts
 * or embedded players while rejecting static assets and account pages.
 */
export function scoreLinkedVideoUrl(
  rawHref: string,
  currentPageUrl: string,
): number {
  const parsed = parseHttpsUrl(rawHref, currentPageUrl);
  const current = parseHttpsUrl(currentPageUrl);

  if (!parsed || !current) return 0;

  if (
    `${parsed.origin}${parsed.pathname}${parsed.search}` ===
    `${current.origin}${current.pathname}${current.search}`
  ) {
    return 0;
  }

  if (
    EXCLUDED_EXTERNAL_VIDEO_HOST_PATTERN.test(parsed.hostname) ||
    LINKED_STATIC_ASSET_PATTERN.test(parsed.pathname) ||
    LINKED_NON_VIDEO_PATH_PATTERN.test(parsed.pathname)
  ) {
    return 0;
  }

  if (LINKED_VIDEO_HOST_PATTERN.test(parsed.hostname)) return 35;
  if (/(?:^|\/)(?:embed|player)(?:\/|$)/i.test(parsed.pathname)) return 32;
  if (!isSameSiteHost(parsed.hostname, current.hostname)) return 0;

  return scoreSameSiteLinkedPath(parsed.pathname);
}

const SIDEBAR_PLAYLIST_ITEM_PATTERN =
  /^\/c\/([^/]+)\/sections\/[^/]+\/lessons\/[^/]+/i;

const SLUG_TRACK_TOPIC_PATTERN = /^\/courses\/([^/]+)/i;

function isSameTrackSiblingUrl(
  candidatePathname: string,
  currentPathname: string,
): boolean {
  const currentSidebar = SIDEBAR_PLAYLIST_ITEM_PATTERN.exec(currentPathname);

  const candidateSidebar =
    SIDEBAR_PLAYLIST_ITEM_PATTERN.exec(candidatePathname);

  if (currentSidebar && candidateSidebar) {
    return (
      currentSidebar[1].toLowerCase() === candidateSidebar[1].toLowerCase()
    );
  }

  const currentTrack = SLUG_TRACK_TOPIC_PATTERN.exec(currentPathname);
  const candidateTrack = SLUG_TRACK_TOPIC_PATTERN.exec(candidatePathname);

  if (currentTrack && candidateTrack) {
    return currentTrack[1].toLowerCase() === candidateTrack[1].toLowerCase();
  }

  return false;
}

/**
 * Checks whether a URL inside a video item's rich-text body points to a
 * supplementary same-origin post or event page rather than a sibling item
 * in the same playlist.
 */
export function isSupplementaryLinkedPostUrl(
  rawUrl: string,
  currentPageUrl: string,
): boolean {
  const candidate = parseHttpsUrl(rawUrl, currentPageUrl);
  const current = parseHttpsUrl(currentPageUrl);

  if (!candidate || !current || candidate.origin !== current.origin) {
    return false;
  }

  if (scoreLinkedVideoUrl(candidate.href, current.href) <= 0) return false;

  return !isSameTrackSiblingUrl(candidate.pathname, current.pathname);
}
