import type { PlaylistDownloadMode } from "../lib/downloads/download-preferences.ts";
import {
  isItemDownloadableForMode,
  summarizeItemCompanionDocuments,
  type ItemCompanionDocuments,
} from "../lib/materials/item-assets.ts";
import type { VideoQualityOption } from "../lib/media/hls-master.ts";
import type { KnownSubtitleTrack } from "../lib/subtitles/subtitle-tracks.ts";

export interface DiscoveredItem {
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

export interface PlaylistScan {
  readonly title: string;
  readonly nextItemIndex: number;
  readonly items: { readonly length: number };
  readonly status: "scanning" | "ready";
  readonly rateLimited?: boolean;
  readonly discovered: readonly DiscoveredItem[];
}

export function hasItemVideo(item: DiscoveredItem): boolean {
  return Boolean(item.url?.trim()) || item.qualityOptions.length > 0;
}

export function isItemSelectable(
  item: DiscoveredItem,
  mode: PlaylistDownloadMode,
): boolean {
  return isItemDownloadableForMode(item, mode);
}

export function selectableItemsForScan(
  scan: PlaylistScan,
  mode: PlaylistDownloadMode,
): readonly DiscoveredItem[] {
  return scan.discovered.filter((item) => isItemSelectable(item, mode));
}

export function selectedIndicesForScan(
  scan: PlaylistScan,
  mode: PlaylistDownloadMode,
  deselected: ReadonlySet<number>,
): number[] {
  return selectableItemsForScan(scan, mode)
    .map((item) => item.itemIndex)
    .filter((index) => !deselected.has(index));
}

export function setItemSelected(
  deselected: Set<number>,
  itemIndex: number,
  selected: boolean,
): void {
  if (selected) {
    deselected.delete(itemIndex);

    return;
  }

  deselected.add(itemIndex);
}

export function playlistRenderSignature(
  mode: PlaylistDownloadMode,
  sorted: readonly DiscoveredItem[],
): string {
  return JSON.stringify([
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
}

export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function downloadButtonLabel(
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

export function selectionUnitLabel(
  mode: PlaylistDownloadMode,
  allHaveVideo: boolean,
): "item" | "video" {
  if (mode === "documents") return "item";
  if (mode === "all" && !allHaveVideo) return "item";

  return "video";
}

export function emptySelectionLabel(mode: PlaylistDownloadMode): string {
  if (mode === "documents") return "No companion documents detected yet";
  if (mode === "videos") return "No videos detected yet";

  return "No downloadable items detected yet";
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

export function itemMetaText(
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

export function scanStatusCopy(
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
