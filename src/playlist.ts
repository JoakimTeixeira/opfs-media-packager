import {
  hasItemVideo,
  isItemSelectable,
  selectableItemsForScan,
  pluralize,
  downloadButtonLabel,
  selectionUnitLabel,
  emptySelectionLabel,
  itemMetaText,
  scanStatusCopy,
  selectedIndicesForScan,
  setItemSelected,
  playlistRenderSignature,
  type DiscoveredItem,
  type PlaylistScan,
} from "./playlist-view.ts";
import {
  PLAYLIST_DOWNLOAD_MODE_OPTIONS,
  DEFAULT_PLAYLIST_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_PREFERENCES,
  OUTPUT_FORMAT_OPTIONS,
  SEGMENT_CONCURRENCY_OPTIONS,
  playlistDownloadModeOrDefault,
  playlistQualityPreferenceOrDefault,
  outputFormatOrDefault,
  renderPreferenceOptions,
  subtitleDownloadPreferenceOrDefault,
  type PlaylistDownloadMode,
} from "../lib/downloads/download-preferences.ts";
import {
  DEFAULT_SEGMENT_CONCURRENCY,
  clampConcurrency,
} from "../lib/downloads/segments.ts";

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) throw new Error(`Missing required element: ${selector}`);

  return element;
}

const scanId = new URLSearchParams(location.search).get("scan");
const title = requireElement<HTMLElement>("#title");
const summary = requireElement<HTMLElement>("#summary");
const progressLabel = requireElement<HTMLElement>("#progress-label");
const progress = requireElement<HTMLProgressElement>("#progress");
const items = requireElement<HTMLElement>("#items");

const playlistDownloadMode = requireElement<HTMLSelectElement>(
  "#playlist-download-mode",
);

const format = requireElement<HTMLSelectElement>("#format");
const playlistQuality = requireElement<HTMLSelectElement>("#playlist-quality");
const subtitleDownload = requireElement<HTMLSelectElement>("#subtitle-mode");

const segmentConcurrency = requireElement<HTMLSelectElement>(
  "#segment-concurrency",
);

const downloadAll = requireElement<HTMLButtonElement>("#download-all");
const selectionCount = document.querySelector<HTMLElement>("#selection-count");

const selectAllButton =
  document.querySelector<HTMLButtonElement>("#select-all");

const deselectAllButton =
  document.querySelector<HTMLButtonElement>("#deselect-all");

/** Indices explicitly unchecked by the user; all others are selected by default. */
const deselectedItemIndices = new Set<number>();

const pageState: {
  latestScan: PlaylistScan | null;
  lastRenderedSignature: string;
} = {
  latestScan: null,
  lastRenderedSignature: "",
};

renderPreferenceOptions(playlistDownloadMode, PLAYLIST_DOWNLOAD_MODE_OPTIONS);
playlistDownloadMode.value = DEFAULT_PLAYLIST_DOWNLOAD_MODE;
renderPreferenceOptions(format, OUTPUT_FORMAT_OPTIONS);
renderPreferenceOptions(segmentConcurrency, SEGMENT_CONCURRENCY_OPTIONS);

function activeDownloadMode(): PlaylistDownloadMode {
  return playlistDownloadModeOrDefault(playlistDownloadMode.value);
}

function applyDownloadModeUi(): void {
  const documentsOnly = activeDownloadMode() === "documents";

  format.disabled = documentsOnly;
  playlistQuality.disabled = documentsOnly;
  subtitleDownload.disabled = documentsOnly;
  segmentConcurrency.disabled = documentsOnly;
}

function updateSelectionControls(scan: PlaylistScan): void {
  const mode = activeDownloadMode();
  const selectable = selectableItemsForScan(scan, mode);
  const total = selectable.length;

  const selectedCount = selectedIndicesForScan(
    scan,
    mode,
    deselectedItemIndices,
  ).length;

  const allHaveVideo = total > 0 && selectable.every(hasItemVideo);

  if (selectionCount) {
    const unit = selectionUnitLabel(mode, allHaveVideo);
    const emptyLabel = emptySelectionLabel(mode);

    selectionCount.textContent = total
      ? `${selectedCount} of ${total} ${pluralize(total, unit)} selected`
      : emptyLabel;
  }

  if (selectAllButton) {
    selectAllButton.disabled = total === 0 || selectedCount === total;
  }

  if (deselectAllButton) {
    deselectAllButton.disabled = total === 0 || selectedCount === 0;
  }

  downloadAll.disabled = scan.status !== "ready" || selectedCount === 0;
  downloadAll.textContent = downloadButtonLabel(selectedCount, total, mode);
}

function buildItemRow(
  item: DiscoveredItem,
  mode: PlaylistDownloadMode,
): HTMLLIElement {
  const listItem = document.createElement("li");
  const applicable = isItemSelectable(item, mode);

  const isSelected = applicable && !deselectedItemIndices.has(item.itemIndex);

  listItem.classList.toggle("unavailable", !applicable);
  listItem.classList.toggle("deselected", applicable && !isSelected);
  const label = document.createElement("label");

  label.className = "item-row";
  const checkbox = document.createElement("input");

  checkbox.type = "checkbox";
  checkbox.className = "item-select";
  checkbox.disabled = !applicable;
  checkbox.checked = isSelected;
  checkbox.dataset.itemIndex = String(item.itemIndex);
  checkbox.setAttribute("aria-label", `Select ${item.title}`);

  checkbox.addEventListener("change", () => {
    setItemSelected(deselectedItemIndices, item.itemIndex, checkbox.checked);
    listItem.classList.toggle("deselected", !checkbox.checked);
    if (pageState.latestScan) updateSelectionControls(pageState.latestScan);
  });

  const copy = document.createElement("div");
  const name = document.createElement("div");

  name.className = "item-name";
  name.textContent = item.title;
  const folder = document.createElement("div");

  folder.className = "item-folder";
  folder.textContent = item.folderPath.join(" / ");
  copy.append(name, folder);
  label.append(checkbox, copy);
  const meta = document.createElement("span");

  meta.className = "item-meta";
  meta.textContent = itemMetaText(item, mode);
  listItem.append(label, meta);

  return listItem;
}

function render(scan: PlaylistScan): void {
  pageState.latestScan = scan;
  title.textContent = scan.title;
  const checked = Math.min(scan.nextItemIndex, scan.items.length);

  progress.max = Math.max(scan.items.length, 1);
  progress.value = checked;
  const mode = activeDownloadMode();
  const selectable = selectableItemsForScan(scan, mode);
  const selectableCount = selectable.length;
  const allHaveVideo = selectableCount > 0 && selectable.every(hasItemVideo);

  const copy = scanStatusCopy(
    scan,
    checked,
    selectableCount,
    mode,
    allHaveVideo,
  );

  progressLabel.textContent = copy.progressText;
  summary.textContent = copy.summaryText;
  applyDownloadModeUi();
  updateSelectionControls(scan);

  const sorted = [...scan.discovered].sort(
    (left, right) => left.itemIndex - right.itemIndex,
  );

  const signature = playlistRenderSignature(mode, sorted);

  if (signature === pageState.lastRenderedSignature) return;
  pageState.lastRenderedSignature = signature;

  items.replaceChildren(...sorted.map((item) => buildItemRow(item, mode)));
}

function setPlaylistFailure(): void {
  summary.textContent =
    "Something interrupted the playlist scan view. Reload this tab or start a new scan from the source page.";
}

async function refresh(): Promise<void> {
  if (!scanId) {
    summary.textContent = "The playlist scan was not found.";

    return;
  }

  const response = (await chrome.runtime
    .sendMessage({
      type: "get-playlist-scan",
      scanId,
    })
    .catch(() => null)) as { scan?: PlaylistScan } | null;

  const scan = response?.scan;

  if (!scan) {
    summary.textContent =
      "The playlist scan expired. Start it again from the source page.";

    return;
  }

  render(scan);

  if (scan.status !== "ready") {
    setTimeout(() => {
      refresh().catch(setPlaylistFailure);
    }, 250);
  }
}

function savePreferences(): void {
  chrome.storage.local.set({
    playlistDownloadMode: playlistDownloadMode.value,
    preferredOutput: format.value,
    playlistQualityPreference: playlistQuality.value,
    subtitleDownloadPreference: subtitleDownload.value,
    segmentConcurrency: Number(segmentConcurrency.value),
  });
}

[
  playlistDownloadMode,
  format,
  playlistQuality,
  subtitleDownload,
  segmentConcurrency,
].forEach((control) => control.addEventListener("change", savePreferences));

playlistDownloadMode.addEventListener("change", () => {
  applyDownloadModeUi();
  if (pageState.latestScan) render(pageState.latestScan);
});

chrome.storage.local
  .get({
    playlistDownloadMode: DEFAULT_PLAYLIST_DOWNLOAD_MODE,
    preferredOutput: DEFAULT_DOWNLOAD_PREFERENCES.outputFormat,
    playlistQualityPreference:
      DEFAULT_DOWNLOAD_PREFERENCES.playlistQualityPreference,
    batchQualityMode: DEFAULT_DOWNLOAD_PREFERENCES.playlistQualityPreference,
    subtitleDownloadPreference:
      DEFAULT_DOWNLOAD_PREFERENCES.subtitleDownloadPreference,
    segmentConcurrency: DEFAULT_DOWNLOAD_PREFERENCES.segmentConcurrency,
  })
  .then(
    ({
      playlistDownloadMode: savedPlaylistDownloadMode,
      preferredOutput,
      playlistQualityPreference,
      batchQualityMode: legacyBatchQualityMode,
      subtitleDownloadPreference,
      segmentConcurrency: savedConcurrency,
    }) => {
      // batchQualityMode is the saved key used by older releases.
      playlistDownloadMode.value = playlistDownloadModeOrDefault(
        savedPlaylistDownloadMode,
      );

      format.value = outputFormatOrDefault(preferredOutput);

      playlistQuality.value = playlistQualityPreferenceOrDefault(
        String(playlistQualityPreference || legacyBatchQualityMode || ""),
      );

      subtitleDownload.value = subtitleDownloadPreferenceOrDefault(
        String(subtitleDownloadPreference || ""),
      );

      segmentConcurrency.value = String(
        clampConcurrency(
          Number(savedConcurrency) || DEFAULT_SEGMENT_CONCURRENCY,
        ),
      );

      applyDownloadModeUi();
      if (pageState.latestScan) render(pageState.latestScan);
    },
  );

selectAllButton?.addEventListener("click", () => {
  if (!pageState.latestScan) return;
  deselectedItemIndices.clear();

  for (const checkbox of items.querySelectorAll<HTMLInputElement>(
    ".item-select:not(:disabled)",
  )) {
    checkbox.checked = true;
    checkbox.closest("li")?.classList.remove("deselected");
  }

  updateSelectionControls(pageState.latestScan);
});

deselectAllButton?.addEventListener("click", () => {
  if (!pageState.latestScan) return;

  for (const item of selectableItemsForScan(
    pageState.latestScan,
    activeDownloadMode(),
  )) {
    deselectedItemIndices.add(item.itemIndex);
  }

  for (const checkbox of items.querySelectorAll<HTMLInputElement>(
    ".item-select:not(:disabled)",
  )) {
    checkbox.checked = false;
    checkbox.closest("li")?.classList.add("deselected");
  }

  updateSelectionControls(pageState.latestScan);
});

downloadAll.addEventListener("click", async () => {
  if (!pageState.latestScan) return;
  const mode = activeDownloadMode();

  const selectedItemIndices = selectedIndicesForScan(
    pageState.latestScan,
    mode,
    deselectedItemIndices,
  );

  if (!selectedItemIndices.length) return;
  downloadAll.disabled = true;

  const result = (await chrome.runtime
    .sendMessage({
      type: "open-playlist-download",
      scanId,
      selectedItemIndices,
      playlistDownloadMode: mode,
      outputFormat: format.value,
      playlistQualityPreference: playlistQuality.value,
      subtitleDownloadPreference: subtitleDownload.value,
      segmentConcurrency: Number(segmentConcurrency.value),
    })
    .catch(() => ({ ok: false }))) as
    { ok?: boolean; error?: string } | undefined;

  if (!result?.ok) {
    summary.textContent =
      result?.error ||
      "Could not open the playlist download. Refresh the source page and try again.";

    downloadAll.disabled = false;
  }
});

window.addEventListener("error", setPlaylistFailure);
window.addEventListener("unhandledrejection", setPlaylistFailure);

refresh().catch(setPlaylistFailure);
