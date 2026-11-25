import { externalTabId, type ExternalValue } from "./external-values.ts";

const maxUrlLength = 8192;

const privateIpv4 =
  /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./;

function isLocalOrPrivateHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "[::1]" ||
    privateIpv4.test(host) ||
    host.endsWith(".local")
  );
}

/**
 * Returns a canonical remote HTTP(S) URL, or null for a URL that must never
 * cross the extension's privileged fetch boundary. This prevents content-page
 * data from turning the service worker into a local-network request proxy.
 */
export function safeMediaUrl(value: ExternalValue): string | null {
  if (typeof value !== "string" || !value || value.length > maxUrlLength) {
    return null;
  }

  if (!value.startsWith("https://") && !value.startsWith("http://")) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.username || url.password) return null;
    if (isLocalOrPrivateHost(url.hostname.toLowerCase())) return null;

    return url.href;
  } catch {
    return null;
  }
}

export function boundedText(value: ExternalValue, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

export function validTabId(value: ExternalValue): value is number {
  return externalTabId(value) !== null;
}
