import { expect, test } from "vitest";
import {
  downloadButtonLabel,
  emptySelectionLabel,
  hasItemVideo,
  isItemSelectable,
  itemMetaText,
  playlistRenderSignature,
  scanStatusCopy,
  selectedIndicesForScan,
  setItemSelected,
  selectionUnitLabel,
  type DiscoveredItem,
  type PlaylistScan,
} from "./playlist-view.ts";

const video: DiscoveredItem = {
  itemIndex: 0,
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

const empty: DiscoveredItem = {
  itemIndex: 1,
  title: "Unavailable lesson",
  folderPath: [],
  qualityOptions: [],
};

const scan: PlaylistScan = {
  title: "Course",
  nextItemIndex: 2,
  items: { length: 2 },
  status: "ready",
  discovered: [video, empty],
};

test("should select eligible lessons while respecting unchecked items", () => {
  expect(hasItemVideo(video)).toBe(true);
  expect(hasItemVideo(empty)).toBe(false);
  expect(isItemSelectable(video, "videos")).toBe(true);
  expect(isItemSelectable(empty, "all")).toBe(false);
  expect(selectedIndicesForScan(scan, "all", new Set())).toEqual([0]);
  expect(selectedIndicesForScan(scan, "all", new Set([0]))).toEqual([]);
  const deselected = new Set<number>();

  setItemSelected(deselected, 0, false);
  expect(deselected.has(0)).toBe(true);
  setItemSelected(deselected, 0, true);
  expect(deselected.has(0)).toBe(false);
});

test("should describe selection and available media", () => {
  expect(downloadButtonLabel(0, 0, "documents")).toBe("Download documents");
  expect(downloadButtonLabel(0, 2, "all")).toBe("Select at least one item");
  expect(downloadButtonLabel(1, 2, "videos")).toBe("Download 1 selected item");
  expect(downloadButtonLabel(2, 2, "all")).toBe("Download all 2 items");
  expect(selectionUnitLabel("all", false)).toBe("item");
  expect(selectionUnitLabel("videos", true)).toBe("video");

  expect(emptySelectionLabel("documents")).toBe(
    "No companion documents detected yet",
  );

  expect(itemMetaText(video, "all")).toContain("English");
});

test("should describe scanning and rate limiting and update render signatures", () => {
  expect(
    scanStatusCopy({ ...scan, status: "scanning" }, 1, 1, "all", true)
      .progressText,
  ).toBe("Checking item 1 of 2…");

  expect(
    scanStatusCopy({ ...scan, rateLimited: true }, 2, 1, "videos", true)
      .progressText,
  ).toContain("Rate limit reached");

  expect(playlistRenderSignature("all", [video])).not.toBe(
    playlistRenderSignature("videos", [video]),
  );
});
