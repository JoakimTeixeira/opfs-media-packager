import {
  hasTopicVideo,
  isTopicSelectable,
  selectableTopicsForScan,
  pluralize,
  downloadButtonLabel,
  selectionUnitLabel,
  emptySelectionLabel,
  topicMetaText,
  scanStatusCopy,
  selectedIndicesForScan,
  setTopicSelected,
  trackRenderSignature,
  type DiscoveredTopic,
  type TrackScan,
} from "./track-view.ts";
import {
  TRACK_DOWNLOAD_MODE_OPTIONS,
  DEFAULT_TRACK_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_PREFERENCES,
  OUTPUT_FORMAT_OPTIONS,
  SEGMENT_CONCURRENCY_OPTIONS,
  trackDownloadModeOrDefault,
  trackQualityPreferenceOrDefault,
  outputFormatOrDefault,
  renderPreferenceOptions,
  subtitleDownloadPreferenceOrDefault,
  type TrackDownloadMode,
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
const items = requireElement<HTMLElement>("#topics");

const trackDownloadMode = requireElement<HTMLSelectElement>(
  "#track-download-mode",
);

const format = requireElement<HTMLSelectElement>("#format");
const trackQuality = requireElement<HTMLSelectElement>("#track-quality");
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
const deselectedTopicIndices = new Set<number>();

const pageState: {
  latestScan: TrackScan | null;
  lastRenderedSignature: string;
} = {
  latestScan: null,
  lastRenderedSignature: "",
};

renderPreferenceOptions(trackDownloadMode, TRACK_DOWNLOAD_MODE_OPTIONS);
trackDownloadMode.value = DEFAULT_TRACK_DOWNLOAD_MODE;
renderPreferenceOptions(format, OUTPUT_FORMAT_OPTIONS);
renderPreferenceOptions(segmentConcurrency, SEGMENT_CONCURRENCY_OPTIONS);

function activeDownloadMode(): TrackDownloadMode {
  return trackDownloadModeOrDefault(trackDownloadMode.value);
}

function applyDownloadModeUi(): void {
  const documentsOnly = activeDownloadMode() === "documents";

  format.disabled = documentsOnly;
  trackQuality.disabled = documentsOnly;
  subtitleDownload.disabled = documentsOnly;
  segmentConcurrency.disabled = documentsOnly;
}

function updateSelectionControls(scan: TrackScan): void {
  const mode = activeDownloadMode();
  const selectable = selectableTopicsForScan(scan, mode);
  const total = selectable.length;

  const selectedCount = selectedIndicesForScan(
    scan,
    mode,
    deselectedTopicIndices,
  ).length;

  const allHaveVideo = total > 0 && selectable.every(hasTopicVideo);

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

function buildTopicRow(
  item: DiscoveredTopic,
  mode: TrackDownloadMode,
): HTMLLIElement {
  const listItem = document.createElement("li");
  const applicable = isTopicSelectable(item, mode);

  const isSelected = applicable && !deselectedTopicIndices.has(item.topicIndex);

  listItem.classList.toggle("unavailable", !applicable);
  listItem.classList.toggle("deselected", applicable && !isSelected);
  const label = document.createElement("label");

  label.className = "topic-row";
  const checkbox = document.createElement("input");

  checkbox.type = "checkbox";
  checkbox.className = "topic-select";
  checkbox.disabled = !applicable;
  checkbox.checked = isSelected;
  checkbox.dataset.topicIndex = String(item.topicIndex);
  checkbox.setAttribute("aria-label", `Select ${item.title}`);

  checkbox.addEventListener("change", () => {
    setTopicSelected(deselectedTopicIndices, item.topicIndex, checkbox.checked);
    listItem.classList.toggle("deselected", !checkbox.checked);
    if (pageState.latestScan) updateSelectionControls(pageState.latestScan);
  });

  const copy = document.createElement("div");
  const name = document.createElement("div");

  name.className = "topic-name";
  name.textContent = item.title;
  const folder = document.createElement("div");

  folder.className = "topic-folder";
  folder.textContent = item.folderPath.join(" / ");
  copy.append(name, folder);
  label.append(checkbox, copy);
  const meta = document.createElement("span");

  meta.className = "topic-meta";
  meta.textContent = topicMetaText(item, mode);
  listItem.append(label, meta);

  return listItem;
}

function render(scan: TrackScan): void {
  pageState.latestScan = scan;
  title.textContent = scan.title;
  const checked = Math.min(scan.nextTopicIndex, scan.items.length);

  progress.max = Math.max(scan.items.length, 1);
  progress.value = checked;
  const mode = activeDownloadMode();
  const selectable = selectableTopicsForScan(scan, mode);
  const selectableCount = selectable.length;
  const allHaveVideo = selectableCount > 0 && selectable.every(hasTopicVideo);

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
    (left, right) => left.topicIndex - right.topicIndex,
  );

  const signature = trackRenderSignature(mode, sorted);

  if (signature === pageState.lastRenderedSignature) return;
  pageState.lastRenderedSignature = signature;

  items.replaceChildren(...sorted.map((item) => buildTopicRow(item, mode)));
}

function setTrackFailure(): void {
  summary.textContent =
    "Something interrupted the track scan view. Reload this tab or start a new scan from the source page.";
}

async function refresh(): Promise<void> {
  if (!scanId) {
    summary.textContent = "The track scan was not found.";

    return;
  }

  const response = (await chrome.runtime
    .sendMessage({
      type: "get-track-scan",
      scanId,
    })
    .catch(() => null)) as { scan?: TrackScan } | null;

  const scan = response?.scan;

  if (!scan) {
    summary.textContent =
      "The track scan expired. Start it again from the source page.";

    return;
  }

  render(scan);

  if (scan.status !== "ready") {
    setTimeout(() => {
      refresh().catch(setTrackFailure);
    }, 250);
  }
}

function savePreferences(): void {
  chrome.storage.local.set({
    trackDownloadMode: trackDownloadMode.value,
    preferredOutput: format.value,
    trackQualityPreference: trackQuality.value,
    subtitleDownloadPreference: subtitleDownload.value,
    segmentConcurrency: Number(segmentConcurrency.value),
  });
}

[
  trackDownloadMode,
  format,
  trackQuality,
  subtitleDownload,
  segmentConcurrency,
].forEach((control) => control.addEventListener("change", savePreferences));

trackDownloadMode.addEventListener("change", () => {
  applyDownloadModeUi();
  if (pageState.latestScan) render(pageState.latestScan);
});

chrome.storage.local
  .get({
    trackDownloadMode: DEFAULT_TRACK_DOWNLOAD_MODE,
    preferredOutput: DEFAULT_DOWNLOAD_PREFERENCES.outputFormat,
    trackQualityPreference: DEFAULT_DOWNLOAD_PREFERENCES.trackQualityPreference,
    batchQualityMode: DEFAULT_DOWNLOAD_PREFERENCES.trackQualityPreference,
    subtitleDownloadPreference:
      DEFAULT_DOWNLOAD_PREFERENCES.subtitleDownloadPreference,
    segmentConcurrency: DEFAULT_DOWNLOAD_PREFERENCES.segmentConcurrency,
  })
  .then(
    ({
      trackDownloadMode: savedTrackDownloadMode,
      preferredOutput,
      trackQualityPreference,
      batchQualityMode: legacyBatchQualityMode,
      subtitleDownloadPreference,
      segmentConcurrency: savedConcurrency,
    }) => {
      // batchQualityMode is the saved key used by older releases.
      trackDownloadMode.value = trackDownloadModeOrDefault(
        savedTrackDownloadMode,
      );

      format.value = outputFormatOrDefault(preferredOutput);

      trackQuality.value = trackQualityPreferenceOrDefault(
        String(trackQualityPreference || legacyBatchQualityMode || ""),
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
  deselectedTopicIndices.clear();

  for (const checkbox of items.querySelectorAll<HTMLInputElement>(
    ".topic-select:not(:disabled)",
  )) {
    checkbox.checked = true;
    checkbox.closest("li")?.classList.remove("deselected");
  }

  updateSelectionControls(pageState.latestScan);
});

deselectAllButton?.addEventListener("click", () => {
  if (!pageState.latestScan) return;

  for (const item of selectableTopicsForScan(
    pageState.latestScan,
    activeDownloadMode(),
  )) {
    deselectedTopicIndices.add(item.topicIndex);
  }

  for (const checkbox of items.querySelectorAll<HTMLInputElement>(
    ".topic-select:not(:disabled)",
  )) {
    checkbox.checked = false;
    checkbox.closest("li")?.classList.add("deselected");
  }

  updateSelectionControls(pageState.latestScan);
});

downloadAll.addEventListener("click", async () => {
  if (!pageState.latestScan) return;
  const mode = activeDownloadMode();

  const selectedTopicIndices = selectedIndicesForScan(
    pageState.latestScan,
    mode,
    deselectedTopicIndices,
  );

  if (!selectedTopicIndices.length) return;
  downloadAll.disabled = true;

  const result = (await chrome.runtime
    .sendMessage({
      type: "open-track-download",
      scanId,
      selectedTopicIndices,
      trackDownloadMode: mode,
      outputFormat: format.value,
      trackQualityPreference: trackQuality.value,
      subtitleDownloadPreference: subtitleDownload.value,
      segmentConcurrency: Number(segmentConcurrency.value),
    })
    .catch(() => ({ ok: false }))) as
    { ok?: boolean; error?: string } | undefined;

  if (!result?.ok) {
    summary.textContent =
      result?.error ||
      "Could not open the track download. Refresh the source page and try again.";

    downloadAll.disabled = false;
  }
});

window.addEventListener("error", setTrackFailure);
window.addEventListener("unhandledrejection", setTrackFailure);

refresh().catch(setTrackFailure);
