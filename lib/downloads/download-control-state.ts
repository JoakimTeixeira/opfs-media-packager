interface DownloadControlInput {
  readonly busy: boolean;
  readonly hasPlaylist: boolean;
  readonly downloadActive: boolean;
  readonly canResumeTrack?: boolean;
}

interface DownloadControlFlags {
  readonly analyzeDisabled: boolean;
  readonly cancelHidden: boolean;
  readonly concurrencyDisabled: boolean;
  readonly downloadDisabled: boolean;
  readonly filenameDisabled: boolean;
  readonly outputDisabled: boolean;
  readonly qualityDisabled: boolean;
  readonly saveSubfolderDisabled: boolean;
  readonly subfolderDisabled: boolean;
}

/**
 * Describes which download controls are safe to edit for the current job
 * lifecycle. Reading video details leaves choices available. A running job
 * locks choices that would change the file being created.
 */
export function downloadControlState(
  input: DownloadControlInput,
): DownloadControlFlags {
  const canChooseQuality = input.hasPlaylist && !input.downloadActive;

  return Object.freeze({
    analyzeDisabled: input.busy,
    cancelHidden: !input.downloadActive,
    concurrencyDisabled: input.downloadActive,
    downloadDisabled:
      input.busy || (!input.hasPlaylist && !input.canResumeTrack),
    filenameDisabled: input.downloadActive,
    outputDisabled: input.downloadActive,
    qualityDisabled: !canChooseQuality,
    saveSubfolderDisabled: input.downloadActive,
    subfolderDisabled: input.downloadActive,
  });
}
