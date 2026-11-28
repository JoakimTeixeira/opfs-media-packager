const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const DEFAULT_OPAQUE_TOKEN_LENGTH = 28;

/**
 * Generates a deterministic synthetic lowercase alphanumeric token matching
 * opaque CDN blob keys (28 base-36 characters) without embedding real tokens
 * or filename extension hints in test URLs.
 */
function syntheticOpaqueToken(
  seed: string,
  length = DEFAULT_OPAQUE_TOKEN_LENGTH,
): string {
  const initialHash = Array.from(seed).reduce(
    (hash, character) =>
      Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );

  return Array.from({ length }, (_slot, position) => {
    const mixed =
      Math.imul((initialHash ^ (position + 1)) >>> 0, 2654435761) >>> 0;

    return BASE36_ALPHABET[mixed % BASE36_ALPHABET.length];
  }).join("");
}

/**
 * Builds a synthetic opaque attachment URL for tests using a deterministic
 * 28-character alphanumeric path token.
 */
export function syntheticOpaqueAssetUrl(
  seed: string,
  origin = "https://assets.example.net",
): string {
  return `${origin}/${syntheticOpaqueToken(seed)}`;
}
