import { afterEach, expect, test, vi } from "vitest";
import { waitForBrowserDownload } from "./browser-download.ts";

function downloadsMock(
  search: () => Promise<Partial<chrome.downloads.DownloadItem>[]>,
) {
  const state: { listener?: (delta: chrome.downloads.DownloadDelta) => void } =
    {};

  const removeListener = vi.fn(() => {
    state.listener = undefined;
  });

  const cancel = vi.fn().mockResolvedValue(undefined);

  const emit = (delta: chrome.downloads.DownloadDelta) =>
    state.listener?.(delta);

  vi.stubGlobal("chrome", {
    downloads: {
      search: vi.fn(search),
      cancel,
      onChanged: {
        addListener: (callback: typeof state.listener) => {
          state.listener = callback;
        },
        removeListener,
      },
    },
  });

  return { emit, removeListener, cancel };
}

afterEach(() => vi.unstubAllGlobals());

test("observes a download that completes while its initial state is checked", async () => {
  const api = downloadsMock(async () => {
    api.emit({ id: 7, state: { current: "complete" } });

    return [{ id: 7, state: "in_progress" }];
  });

  await expect(waitForBrowserDownload(7)).resolves.toMatchObject({
    id: 7,
    state: { current: "complete" },
  });

  expect(api.removeListener).toHaveBeenCalledOnce();
});

test("handles a download that completed before the listener was registered", async () => {
  const api = downloadsMock(async () => [{ id: 7, state: "complete" }]);

  await expect(waitForBrowserDownload(7)).resolves.toMatchObject({
    id: 7,
    state: "complete",
  });

  expect(api.removeListener).toHaveBeenCalledOnce();
});

test("rejects an interrupted download and removes the listener", async () => {
  const api = downloadsMock(async () => [{ id: 7, state: "interrupted" }]);

  await expect(waitForBrowserDownload(7)).rejects.toThrow("Chrome interrupted");
  expect(api.removeListener).toHaveBeenCalledOnce();
});

test("cancels an already aborted download", async () => {
  const api = downloadsMock(async () => []);
  const controller = new AbortController();

  controller.abort();

  await expect(
    waitForBrowserDownload(7, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });

  expect(api.cancel).toHaveBeenCalledWith(7);
  expect(api.removeListener).toHaveBeenCalledOnce();
});

test("removes the listener if the initial state lookup fails", async () => {
  const api = downloadsMock(async () => {
    throw new Error("lookup failed");
  });

  await expect(waitForBrowserDownload(7)).rejects.toThrow("lookup failed");
  expect(api.removeListener).toHaveBeenCalledOnce();
});
