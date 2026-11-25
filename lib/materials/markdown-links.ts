import { safeMediaUrl } from "../security/security.ts";

function resolvePathHref(pathHref: string, pageUrl?: string): string | null {
  const safePage = pageUrl ? safeMediaUrl(pageUrl) : null;

  if (!safePage) return pathHref.replace(/\s/g, "%20");

  return safeMediaUrl(new URL(pathHref, safePage).href);
}

function resolveRelativeHref(href: string, pageUrl?: string): string | null {
  if (!pageUrl || href.startsWith("//") || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;

  const safePage = safeMediaUrl(pageUrl);

  if (!safePage) return null;

  return safeMediaUrl(new URL(href, safePage).href);
}

export function safeMarkdownHref(
  rawHref: unknown,
  pageUrl?: string,
): string | null {
  if (typeof rawHref !== "string") return null;

  const trimmed = rawHref.trim();

  if (!trimmed || /[\r\n\0]/.test(trimmed)) return null;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return resolvePathHref(trimmed, pageUrl);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const normalized = trimmed.replace(/^https?:\/\//i, (scheme) =>
      scheme.toLowerCase(),
    );

    return safeMediaUrl(normalized);
  }

  return resolveRelativeHref(trimmed, pageUrl);
}
