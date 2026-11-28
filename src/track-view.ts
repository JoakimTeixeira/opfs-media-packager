import type { TrackDownloadMode } from "../lib/downloads/download-preferences.ts";
import {
  isTopicDownloadableForMode,
  summarizeTopicCompanionDocuments,
  type TopicCompanionDocuments,
} from "../lib/materials/topic-assets.ts";
import type { VideoQualityOption } from "../lib/media/hls-master.ts";
import type { KnownSubtitleTrack } from "../lib/subtitles/subtitle-tracks.ts";

export interface DiscoveredTopic {
  readonly topicIndex: number;
  readonly title: string;
  readonly url?: string;
  readonly folderPath: readonly string[];
  readonly qualityOptions: readonly VideoQualityOption[];
  readonly subtitles?: readonly KnownSubtitleTrack[];
  readonly extraVideos?: readonly {
    readonly title: string;
    readonly url: string;
  }[];
  readonly documents?: TopicCompanionDocuments;
}

export interface TrackScan {
  readonly title: string;
  readonly nextTopicIndex: number;
  readonly items: { readonly length: number };
  readonly status: "scanning" | "ready";
  readonly rateLimited?: boolean;
  readonly discovered: readonly DiscoveredTopic[];
}

export function hasTopicVideo(item: DiscoveredTopic): boolean {
  return Boolean(item.url?.trim()) || item.qualityOptions.length > 0;
}

export function isTopicSelectable(
  item: DiscoveredTopic,
  mode: TrackDownloadMode,
): boolean {
  return isTopicDownloadableForMode(item, mode);
}

export function selectableTopicsForScan(
  scan: TrackScan,
  mode: TrackDownloadMode,
): readonly DiscoveredTopic[] {
  return scan.discovered.filter((item) => isTopicSelectable(item, mode));
}

export function selectedIndicesForScan(
  scan: TrackScan,
  mode: TrackDownloadMode,
  deselected: ReadonlySet<number>,
): number[] {
  return selectableTopicsForScan(scan, mode)
    .map((item) => item.topicIndex)
    .filter((index) => !deselected.has(index));
}

export function setTopicSelected(
  deselected: Set<number>,
  topicIndex: number,
  selected: boolean,
): void {
  if (selected) {
    deselected.delete(topicIndex);

    return;
  }

  deselected.add(topicIndex);
}

export function trackRenderSignature(
  mode: TrackDownloadMode,
  sorted: readonly DiscoveredTopic[],
): string {
  return JSON.stringify([
    mode,
    sorted.map((item) => [
      item.topicIndex,
      item.title,
      item.url || "",
      item.folderPath,
      item.qualityOptions.length,
      item.extraVideos?.length ?? 0,
      item.subtitles?.[0]?.language || "",
      summarizeTopicCompanionDocuments(item.documents),
    ]),
  ]);
}

export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function downloadButtonLabel(
  selectedCount: number,
  total: number,
  mode: TrackDownloadMode,
): string {
  if (total === 0) {
    return mode === "documents"
      ? "Download documents"
      : "Download selected topics";
  }

  if (selectedCount === 0) return "Select at least one topic";

  const prefix = mode === "documents" ? "Download documents for " : "Download ";

  if (selectedCount === total) {
    return `${prefix}all ${total} ${pluralize(total, "topic")}`;
  }

  return `${prefix}${selectedCount} selected ${pluralize(selectedCount, "topic")}`;
}

export function selectionUnitLabel(
  mode: TrackDownloadMode,
  allHaveVideo: boolean,
): "topic" | "video" {
  if (mode === "documents") return "topic";
  if (mode === "all" && !allHaveVideo) return "topic";

  return "video";
}

export function emptySelectionLabel(mode: TrackDownloadMode): string {
  if (mode === "documents") return "No companion documents detected yet";
  if (mode === "videos") return "No videos detected yet";

  return "No downloadable topics detected yet";
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

export function topicMetaText(
  item: DiscoveredTopic,
  mode: TrackDownloadMode,
): string {
  const qualityCount = item.qualityOptions.length;
  const hasVideo = hasTopicVideo(item);
  const documentBadges = summarizeTopicCompanionDocuments(item.documents);
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
  mode: TrackDownloadMode,
  allHaveVideo: boolean,
): { readonly readyLabel: string; readonly summaryText: string } {
  if (mode === "documents") {
    return {
      readyLabel: `${selectableCount} ${pluralize(selectableCount, "topic")} with documents ready`,
      summaryText: `${selectableCount} ${pluralize(selectableCount, "topic")} with companion documents found. Uncheck any topic you want to skip.`,
    };
  }

  if (mode === "all" && !allHaveVideo) {
    return {
      readyLabel: `${selectableCount} ${pluralize(selectableCount, "topic")} ready`,
      summaryText: `${selectableCount} ${pluralize(selectableCount, "topic")} with downloadable content found. Uncheck any topic you want to skip.`,
    };
  }

  return {
    readyLabel: `${selectableCount} ${pluralize(selectableCount, "stream topic")} ready`,
    summaryText: `${selectableCount} ${pluralize(selectableCount, "playable topic")} found. Uncheck any topic you want to skip.`,
  };
}

export function scanStatusCopy(
  scan: TrackScan,
  checked: number,
  selectableCount: number,
  mode: TrackDownloadMode,
  allHaveVideo: boolean,
): Readonly<{ progressText: string; summaryText: string }> {
  if (scan.status !== "ready") {
    return Object.freeze({
      progressText: `Checking topic ${checked} of ${scan.items.length}…`,
      summaryText:
        "Scanning topics headlessly using your signed-in browser session with polite request pacing. You can choose settings while this finishes.",
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
      summaryText: `The source site temporarily rate-limited requests, so scanning paused to protect your session. Wait a few minutes before scanning again, or download the ${selectableCount} ${pluralize(selectableCount, "topic")} already found.`,
    });
  }

  return Object.freeze({
    progressText: readyLabel,
    summaryText,
  });
}
