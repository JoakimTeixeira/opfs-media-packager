import { mediaReferrerPolicy } from "./player-adapters.ts";
import { safeMediaUrl } from "../security/security.ts";

interface MediaRequestInput {
  readonly mediaUrl: string;
  readonly sourcePageUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: HeadersInit;
}

/**
 * Creates fetch options for one playlist, video segment, or subtitle request.
 * A segment is one short piece of a streamed video. The parameter object keeps
 * the signed-in browser context explicit for every media request.
 */
export function createMediaRequest(input: MediaRequestInput): RequestInit {
  const request: RequestInit = {
    cache: "no-store",
    credentials: "include",
    redirect: "error",
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };

  const sourcePageUrl = safeMediaUrl(input.sourcePageUrl);

  if (!sourcePageUrl) return Object.freeze(request);

  return Object.freeze({
    ...request,
    referrer: sourcePageUrl,
    referrerPolicy: mediaReferrerPolicy(input.mediaUrl, sourcePageUrl),
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Fetches a media manifest, segment, or subtitle using the signed-in browser
 * request first, falling back to a credential-free request when a CDN responds
 * with wildcard CORS or safe remote HTTP redirects.
 */
export async function fetchDirectMedia(
  input: MediaRequestInput,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const safeUrl = safeMediaUrl(input.mediaUrl);

  if (!safeUrl) throw new Error("Unsafe media URL.");

  try {
    return await fetchFn(
      safeUrl,
      createMediaRequest({ ...input, mediaUrl: safeUrl }),
    );
  } catch (error) {
    if (isAbortError(error)) throw error;

    const fallback = await fetchFn(safeUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
    });

    if (fallback.url && !safeMediaUrl(fallback.url)) {
      throw new Error("Unsafe redirected media URL.");
    }

    return fallback;
  }
}
