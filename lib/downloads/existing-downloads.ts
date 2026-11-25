interface ExistingDownloadCandidate {
  readonly filename?: string;
  readonly state?: string;
  readonly exists?: boolean;
  readonly fileSize?: number;
}

export const COMMON_IMAGE_EXTENSIONS: readonly string[] = Object.freeze([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
]);

/**
 * Normalizes a Chrome download path or relative target path for case-insensitive
 * forward-slash matching across Windows and POSIX filesystems.
 */
export function normalizeDownloadPath(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^(?:\.?\/)+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isUsableExistingDownload(item: ExistingDownloadCandidate): boolean {
  if (!item.filename || item.exists !== true) return false;
  if (item.state !== undefined && item.state !== "complete") return false;

  return item.fileSize !== 0;
}

/**
 * Builds an index of normalized full paths for completed Chrome downloads whose
 * files still exist on disk.
 */
export function buildExistingDownloadIndex(
  items: readonly ExistingDownloadCandidate[],
): Set<string> {
  const index = new Set<string>();

  for (const item of items) {
    if (!isUsableExistingDownload(item)) continue;
    const normalized = normalizeDownloadPath(item.filename || "");

    if (normalized) index.add(normalized);
  }

  return index;
}

/**
 * Returns true when an already-downloaded file matches the exact relative
 * folder + filename target inside Chrome Downloads.
 */
export function hasExistingDownload(
  existingPaths: ReadonlySet<string>,
  relativePath: string,
): boolean {
  const normalizedTarget = normalizeDownloadPath(relativePath);

  if (!normalizedTarget || !existingPaths.size) return false;

  for (const entry of existingPaths) {
    if (entry === normalizedTarget || entry.endsWith(`/${normalizedTarget}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves an already-downloaded filename when the exact file extension is not
 * yet known until HTTP headers arrive (such as extensionless image assets).
 */
export function findExistingFilenameByExtensions(
  existingPaths: ReadonlySet<string>,
  folder: string,
  candidateBuilder: (extension: string) => string,
  extensions: readonly string[],
): string | null {
  const cleanFolder = normalizeDownloadPath(folder);

  for (const extension of extensions) {
    const candidate = candidateBuilder(extension);

    const relativeTarget = cleanFolder
      ? `${cleanFolder}/${candidate}`
      : candidate;

    if (hasExistingDownload(existingPaths, relativeTarget)) {
      return candidate;
    }
  }

  return null;
}
