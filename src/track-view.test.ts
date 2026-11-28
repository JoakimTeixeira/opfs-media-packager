import { expect, test } from "vitest";
import {
  downloadButtonLabel,
  emptySelectionLabel,
  hasTopicVideo,
  isTopicSelectable,
  topicMetaText,
  trackRenderSignature,
  scanStatusCopy,
  selectedIndicesForScan,
  setTopicSelected,
  selectionUnitLabel,
  type DiscoveredTopic,
  type TrackScan,
} from "./track-view.ts";

const video: DiscoveredTopic = {
  topicIndex: 0,
  title: "First lesson",
  url: "https://media.example/first.m3u8",
  folderPath: ["Course"],
  qualityOptions: [],
  subtitles: [
    {
      url: "https://media.example/en.vtt",
      language: "English",
      label: "English",
    },
  ],
};

const empty: DiscoveredTopic = {
  topicIndex: 1,
  title: "Unavailable lesson",
  folderPath: [],
  qualityOptions: [],
};

const scan: TrackScan = {
  title: "Course",
  nextTopicIndex: 2,
  items: { length: 2 },
  status: "ready",
  discovered: [video, empty],
};

test("should select eligible lessons while respecting unchecked items", () => {
  expect(hasTopicVideo(video)).toBe(true);
  expect(hasTopicVideo(empty)).toBe(false);
  expect(isTopicSelectable(video, "videos")).toBe(true);
  expect(isTopicSelectable(empty, "all")).toBe(false);
  expect(selectedIndicesForScan(scan, "all", new Set())).toEqual([0]);
  expect(selectedIndicesForScan(scan, "all", new Set([0]))).toEqual([]);
  const deselected = new Set<number>();

  setTopicSelected(deselected, 0, false);
  expect(deselected.has(0)).toBe(true);
  setTopicSelected(deselected, 0, true);
  expect(deselected.has(0)).toBe(false);
});

test("should describe selection and available media", () => {
  expect(downloadButtonLabel(0, 0, "documents")).toBe("Download documents");
  expect(downloadButtonLabel(0, 2, "all")).toBe("Select at least one topic");
  expect(downloadButtonLabel(1, 2, "videos")).toBe("Download 1 selected topic");
  expect(downloadButtonLabel(2, 2, "all")).toBe("Download all 2 topics");
  expect(selectionUnitLabel("all", false)).toBe("topic");
  expect(selectionUnitLabel("videos", true)).toBe("video");

  expect(emptySelectionLabel("documents")).toBe(
    "No companion documents detected yet",
  );

  expect(topicMetaText(video, "all")).toContain("English");
});

test("should describe scanning and rate limiting and update render signatures", () => {
  expect(
    scanStatusCopy({ ...scan, status: "scanning" }, 1, 1, "all", true)
      .progressText,
  ).toBe("Checking topic 1 of 2…");

  expect(
    scanStatusCopy({ ...scan, rateLimited: true }, 2, 1, "videos", true)
      .progressText,
  ).toContain("Rate limit reached");

  expect(trackRenderSignature("all", [video])).not.toBe(
    trackRenderSignature("videos", [video]),
  );
});
