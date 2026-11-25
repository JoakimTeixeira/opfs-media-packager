export function waitForBrowserDownload(
  downloadId: number,
  signal?: AbortSignal,
): Promise<chrome.downloads.DownloadItem | chrome.downloads.DownloadDelta> {
  return new Promise((resolve, reject) => {
    const state = { settled: false };

    const settle = (finish: () => void): void => {
      if (state.settled) return;
      state.settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      signal?.removeEventListener("abort", onAbort);
      finish();
    };

    const onAbort = (): void => {
      chrome.downloads.cancel(downloadId).catch(() => {});

      settle(() =>
        reject(new DOMException("Download cancelled", "AbortError")),
      );
    };

    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "in_progress") return;

      if (delta.state.current === "complete") {
        settle(() => resolve(delta));

        return;
      }

      settle(() => reject(new Error("Chrome interrupted the file download.")));
    };

    chrome.downloads.onChanged.addListener(listener);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();

      return;
    }

    chrome.downloads.search({ id: downloadId }).then(
      ([existing]) => {
        if (existing?.state === "complete") settle(() => resolve(existing));

        if (existing?.state === "interrupted") {
          settle(() =>
            reject(new Error("Chrome interrupted the file download.")),
          );
        }
      },
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
