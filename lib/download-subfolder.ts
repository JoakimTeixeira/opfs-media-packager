import type { ExternalValue } from "./external-values.ts";
import { sanitizeFilenameStem } from "./filename.ts";

export const DEFAULT_DOWNLOAD_SUBFOLDER = "HLS Videos";

/**
 * Returns a safe relative folder below Chrome Downloads. Absolute paths,
 * traversal segments, and empty values use the extension's default folder.
 */
export function downloadSubfolderOrDefault(value: ExternalValue): string {
  if (typeof value !== "string") return DEFAULT_DOWNLOAD_SUBFOLDER;
  const source = value.trim();

  if (!source || /^(?:[a-z]:|[\\/])/i.test(source)) {
    return DEFAULT_DOWNLOAD_SUBFOLDER;
  }

  const rawParts = source.replaceAll("\\", "/").split("/");

  if (rawParts.some((part) => part.trim() === "..")) {
    return DEFAULT_DOWNLOAD_SUBFOLDER;
  }

  const parts = rawParts
    .map((part) => part.trim())
    .filter((part) => part && part !== ".")
    .map(sanitizeFilenameStem)
    .filter(Boolean);

  return parts.join("/") || DEFAULT_DOWNLOAD_SUBFOLDER;
}

/**
 * Builds the filename accepted by chrome.downloads. It is always relative to
 * the user's Downloads location and cannot escape the configured subfolder.
 */
export function downloadRelativePath(
  subfolder: ExternalValue,
  filename: string,
): string {
  return `${downloadSubfolderOrDefault(subfolder)}/${filename}`;
}
