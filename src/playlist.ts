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
import type { VideoQualityOption } from "../lib/media/hls-master.ts";
import {
  isItemDownloadableForMode,
  summarizeItemCompanionDocuments,
  type ItemCompanionDocuments,
} from "../lib/materials/item-assets.ts";
import {
  DEFAULT_SEGMENT_CONCURRENCY,
  clampConcurrency,
} from "../lib/downloads/segments.ts";
import type { KnownSubtitleTrack } from "../lib/subtitles/subtitle-tracks.ts";

interface DiscoveredItem {
  readonly itemIndex: number;
  readonly title: string;
  readonly url?: string;
  readonly folderPath: readonly string[];
  readonly qualityOptions: readonly VideoQualityOption[];
  readonly subtitles?: readonly KnownSubtitleTrack[];
  readonly extraVideos?: readonly {
    readonly title: string;
    readonly url: string;
  }[];
  readonly documents?: ItemCompanionDocuments;
}

interface PlaylistScan {
  readonly title: string;
  readonly nextItemIndex: number;
  readonly items: { readonly length: number };
  readonly status: "scanning" | "ready";
  readonly rateLimited?: boolean;
  readonly discovered: readonly DiscoveredItem[];
}

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

function hasItemVideo(item: DiscoveredItem): boolean {
  return Boolean(item.url?.trim()) || item.qualityOptions.length > 0;
}

function isItemSelectable(
  item: DiscoveredItem,
  mode: PlaylistDownloadMode,
): boolean {
  return isItemDownloadableForMode(item, mode);
}

function selectableItemsForScan(
  scan: PlaylistScan,
  mode: PlaylistDownloadMode,
): readonly DiscoveredItem[] {
  return scan.discovered.filter((item) => isItemSelectable(item, mode));
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function downloadButtonLabel(
  selectedCount: number,
  total: number,
  mode: PlaylistDownloadMode,
): string {
  if (total === 0) {
    return mode === "documents"
      ? "Download documents"
      : "Download selected items";
  }

  if (selectedCount === 0) return "Select at least one item";

  const prefix = mode === "documents" ? "Download documents for " : "Download ";

  if (selectedCount === total) {
    return `${prefix}all ${total} ${pluralize(total, "item")}`;
  }

  return `${prefix}${selectedCount} selected ${pluralize(selectedCount, "item")}`;
}

function selectedIndicesForScan(
  scan: PlaylistScan,
  mode: PlaylistDownloadMode = activeDownloadMode(),
): number[] {
  return selectableItemsForScan(scan, mode)
    .map((item) => item.itemIndex)
    .filter((index) => !deselectedItemIndices.has(index));
}

function selectionUnitLabel(
  mode: PlaylistDownloadMode,
  allHaveVideo: boolean,
): "item" | "video" {
  if (mode === "documents") return "item";
  if (mode === "all" && !allHaveVideo) return "item";

  return "video";
}

function emptySelectionLabel(mode: PlaylistDownloadMode): string {
  if (mode === "documents") return "No companion documents detected yet";
  if (mode === "videos") return "No videos detected yet";

  return "No downloadable items detected yet";
}

function updateSelectionControls(scan: PlaylistScan): void {
  const mode = activeDownloadMode();
  const selectable = selectableItemsForScan(scan, mode);
  const total = selectable.length;
  const selectedCount = selectedIndicesForScan(scan, mode).length;
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

function setItemSelected(itemIndex: number, selected: boolean): void {
  if (selected) {
    deselectedItemIndices.delete(itemIndex);

    return;
  }

  deselectedItemIndices.add(itemIndex);
}

function videoSummaryText(
  qualityCount: number,
  extraVideoCount: number,
): string {
  if (extraVideoCount > 0) return `${1 + extraVideoCount} videos`;

  if (qualityCount > 0) {
    return `${qualityCount} ${pluralize(qualityCount, "quality option")}`;
  }

  return "Video stream";
}

function itemMetaText(
  item: DiscoveredItem,
  mode: PlaylistDownloadMode,
): string {
  const qualityCount = item.qualityOptions.length;
  const hasVideo = hasItemVideo(item);
  const documentBadges = summarizeItemCompanionDocuments(item.documents);
  const parts: string[] = [];

  if (hasVideo) {
    parts.push(videoSummaryText(qualityCount, item.extraVideos?.length ?? 0));
  }

  if (mode !== "documents" && item.subtitles?.[0]?.language) {
    parts.push(item.subtitles[0].language);
  }

  if (!hasVideo && mode !== "documents") {
    parts.push(documentBadges.length > 0 ? "Documents only" : "Subtitle only");
  }

  parts.push(...documentBadges);

  if (mode === "documents" && !documentBadges.length) {
    parts.push("No documents");
  }

  return parts.join(" · ");
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
    setItemSelected(item.itemIndex, checkbox.checked);
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

function readyStatusLabels(
  selectableCount: number,
  mode: PlaylistDownloadMode,
  allHaveVideo: boolean,
): { readonly readyLabel: string; readonly summaryText: string } {
  if (mode === "documents") {
    return {
      readyLabel: `${selectableCount} ${pluralize(selectableCount, "item")} with documents ready`,
      summaryText: `${selectableCount} ${pluralize(selectableCount, "item")} with companion documents found. Uncheck any item you want to skip.`,
    };
  }

  if (mode === "all" && !allHaveVideo) {
    return {
      readyLabel: `${selectableCount} ${pluralize(selectableCount, "item")} ready`,
      summaryText: `${selectableCount} ${pluralize(selectableCount, "item")} with downloadable content found. Uncheck any item you want to skip.`,
    };
  }

  return {
    readyLabel: `${selectableCount} ${pluralize(selectableCount, "stream item")} ready`,
    summaryText: `${selectableCount} ${pluralize(selectableCount, "playable item")} found. Uncheck any item you want to skip.`,
  };
}

function scanStatusCopy(
  scan: PlaylistScan,
  checked: number,
  selectableCount: number,
  mode: PlaylistDownloadMode,
  allHaveVideo: boolean,
): Readonly<{ progressText: string; summaryText: string }> {
  if (scan.status !== "ready") {
    return Object.freeze({
      progressText: `Checking item ${checked} of ${scan.items.length}…`,
      summaryText:
        "Scanning items headlessly using your signed-in browser session with polite request pacing. You can choose settings while this finishes.",
    });
  }

  const { readyLabel, summaryText } = readyStatusLabels(
    selectableCount,
    mode,
    allHaveVideo,
  );

  if (scan.rateLimited) {
    return Object.freeze({
      progressText: `Rate limit reached · ${readyLabel}`,
      summaryText: `The source site temporarily rate-limited requests, so scanning paused to protect your session. Wait a few minutes before scanning again, or download the ${selectableCount} ${pluralize(selectableCount, "item")} already found.`,
    });
  }

  return Object.freeze({
    progressText: readyLabel,
    summaryText,
  });
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

  const signature = JSON.stringify([
    mode,
    sorted.map((item) => [
      item.itemIndex,
      item.title,
      item.url || "",
      item.folderPath,
      item.qualityOptions.length,
      item.extraVideos?.length ?? 0,
      item.subtitles?.[0]?.language || "",
      summarizeItemCompanionDocuments(item.documents),
    ]),
  ]);

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
