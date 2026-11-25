import test from "node:test";
import assert from "node:assert/strict";
import {
  countItemCompanionDocuments,
  summarizeItemCompanionDocuments,
  type ItemFileAsset,
  type ItemLinkAsset,
  type ItemCompanionDocuments,
  isItemDownloadableForMode,
} from "./item-assets.ts";

test("should count and summarize lesson materials accurately", () => {
  assert.equal(countItemCompanionDocuments(null), 0);
  assert.equal(countItemCompanionDocuments(undefined), 0);
  assert.deepEqual(summarizeItemCompanionDocuments(null), []);
  assert.deepEqual(summarizeItemCompanionDocuments(undefined), []);

  const empty: ItemCompanionDocuments = {
    markdown: "",
    images: [],
    pdfs: [],
    diagrams: [],
    slides: [],
  };

  assert.equal(countItemCompanionDocuments(empty), 0);
  assert.deepEqual(summarizeItemCompanionDocuments(empty), []);

  const img1: ItemFileAsset = {
    kind: "image",
    url: "https://cdn.example/1.png",
    filename: "1.png",
  };

  const pdf1: ItemFileAsset = {
    kind: "pdf",
    url: "https://cdn.example/1.pdf",
    filename: "1.pdf",
  };

  const diag1: ItemLinkAsset = {
    kind: "diagram",
    url: "https://excalidraw.com/#1",
    title: "D1",
  };

  const slide1: ItemLinkAsset = {
    kind: "slides",
    url: "https://slides.example/?slide=1",
    title: "S1",
  };

  const single: ItemCompanionDocuments = {
    markdown: "# Lesson\n",
    images: [img1],
    pdfs: [pdf1],
    diagrams: [diag1],
    slides: [slide1],
  };

  assert.equal(countItemCompanionDocuments(single), 5);

  assert.deepEqual(summarizeItemCompanionDocuments(single), [
    "MD",
    "1 PDF",
    "1 image",
    "1 diagram",
    "1 slides",
  ]);

  const plural: ItemCompanionDocuments = {
    markdown: "",
    images: [
      img1,
      { kind: "image", url: "https://cdn.example/2.png", filename: "2.png" },
    ],
    pdfs: [
      pdf1,
      { kind: "pdf", url: "https://cdn.example/2.pdf", filename: "2.pdf" },
    ],
    diagrams: [
      diag1,
      { kind: "diagram", url: "https://excalidraw.com/#2", title: "D2" },
    ],
    slides: [
      slide1,
      { kind: "slides", url: "https://slides.example/?slide=2", title: "S2" },
    ],
  };

  assert.equal(countItemCompanionDocuments(plural), 8);

  assert.deepEqual(summarizeItemCompanionDocuments(plural), [
    "2 PDFs",
    "2 images",
    "2 diagrams",
    "2 slides",
  ]);
});

test("should evaluate lesson eligibility per download mode across video, subtitle, and material subsets", () => {
  const sampleMaterials: ItemCompanionDocuments = {
    markdown: "# Notes\n",
    images: [],
    pdfs: [],
    diagrams: [],
    slides: [],
  };

  const emptyLesson = { url: "", qualityOptions: [], subtitles: [] };
  const videoOnly = { url: "https://media.example/master.m3u8" };
  const qualityOnly = { url: "", qualityOptions: [{ label: "720p" }] };

  const subtitleOnly = {
    url: "",
    subtitles: [
      { url: "https://media.example/pt.vtt", language: "Portuguese" },
    ],
  };

  const documentsOnly = { url: "", documents: sampleMaterials };

  const combined = {
    url: "https://media.example/master.m3u8",
    subtitles: [{ url: "https://media.example/pt.vtt" }],
    documents: sampleMaterials,
  };

  for (const mode of ["all", "videos", "documents"] as const) {
    assert.equal(isItemDownloadableForMode(emptyLesson, mode), false);
    assert.equal(isItemDownloadableForMode(combined, mode), true);
  }

  assert.equal(isItemDownloadableForMode(videoOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(videoOnly, "videos"), true);
  assert.equal(isItemDownloadableForMode(videoOnly, "documents"), false);

  assert.equal(isItemDownloadableForMode(qualityOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(qualityOnly, "videos"), true);
  assert.equal(isItemDownloadableForMode(qualityOnly, "documents"), false);

  assert.equal(isItemDownloadableForMode(subtitleOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(subtitleOnly, "videos"), true);
  assert.equal(isItemDownloadableForMode(subtitleOnly, "documents"), false);

  assert.equal(isItemDownloadableForMode(documentsOnly, "all"), true);
  assert.equal(isItemDownloadableForMode(documentsOnly, "videos"), false);
  assert.equal(isItemDownloadableForMode(documentsOnly, "documents"), true);
});
