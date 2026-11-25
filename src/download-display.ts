export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error || "");
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}

export function userError(error: unknown): string {
  const technical = errorMessageOf(error);

  console.error("OPFS Media Packager", error);

  if (/\b(?:401|403)\b/.test(technical)) {
    return "This video host could not confirm access. Keep the source page open and signed in, refresh it, then try again.";
  }

  if (/encrypted/i.test(technical)) {
    return "This video is protected and cannot be downloaded by this extension.";
  }

  if (/live|unfinished/i.test(technical)) {
    return "Only completed, on-demand videos are supported.";
  }

  if (/quota|storage|OPFS/i.test(technical)) {
    return "Not enough free browser storage space to assemble this video. Free some disk space, then try again.";
  }

  if (
    /MP4 engine|FFmpeg|Array buffer|out of memory|OOM|WebAssembly/i.test(
      technical,
    )
  ) {
    return "The MP4 converter ran out of resources or stopped unexpectedly. Close extra heavy tabs and try again.";
  }

  if (/folder|download/i.test(technical)) {
    return "Chrome could not save this file. Check that downloads are allowed, then try again.";
  }

  return "Try refreshing the video page, then start the download again.";
}

export function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );

  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
