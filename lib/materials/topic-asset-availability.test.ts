import { test } from "vitest";
import assert from "node:assert/strict";
import {
  countTopicCompanionDocuments,
  summarizeTopicCompanionDocuments,
  isTopicDownloadableForMode,
} from "./topic-asset-availability.ts";
import type {
  TopicFileAsset,
  TopicLinkAsset,
  TopicCompanionDocuments,
} from "./topic-assets.ts";

test("should count and summarize lesson materials accurately", () => {
  assert.equal(countTopicCompanionDocuments(null), 0);
  assert.equal(countTopicCompanionDocuments(undefined), 0);
  assert.deepEqual(summarizeTopicCompanionDocuments(null), []);
  assert.deepEqual(summarizeTopicCompanionDocuments(undefined), []);

  const empty: TopicCompanionDocuments = {
    markdown: "",
    images: [],
    pdfs: [],
    diagrams: [],
    slides: [],
  };

  assert.equal(countTopicCompanionDocuments(empty), 0);
  assert.deepEqual(summarizeTopicCompanionDocuments(empty), []);

  const img1: TopicFileAsset = {
    kind: "image",
    url: "https://cdn.example/1.png",
    filename: "1.png",
  };

  const pdf1: TopicFileAsset = {
    kind: "pdf",
    url: "https://cdn.example/1.pdf",
    filename: "1.pdf",
  };

  const diag1: TopicLinkAsset = {
    kind: "diagram",
    url: "https://excalidraw.com/#1",
    title: "D1",
  };

  const slide1: TopicLinkAsset = {
    kind: "slides",
    url: "https://slides.example/?slide=1",
    title: "S1",
  };

  const single: TopicCompanionDocuments = {
    markdown: "# Lesson\n",
    images: [img1],
    pdfs: [pdf1],
    diagrams: [diag1],
    slides: [slide1],
  };

  assert.equal(countTopicCompanionDocuments(single), 5);

  assert.deepEqual(summarizeTopicCompanionDocuments(single), [
    "MD",
    "1 PDF",
    "1 image",
    "1 diagram",
    "1 slides",
  ]);

  const plural: TopicCompanionDocuments = {
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

  assert.equal(countTopicCompanionDocuments(plural), 8);

  assert.deepEqual(summarizeTopicCompanionDocuments(plural), [
    "2 PDFs",
    "2 images",
    "2 diagrams",
    "2 slides",
  ]);
});

test("should evaluate lesson eligibility per download mode across video, subtitle, and material subsets", () => {
  const sampleMaterials: TopicCompanionDocuments = {
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
    assert.equal(isTopicDownloadableForMode(emptyLesson, mode), false);
    assert.equal(isTopicDownloadableForMode(combined, mode), true);
  }

  assert.equal(isTopicDownloadableForMode(videoOnly, "all"), true);
  assert.equal(isTopicDownloadableForMode(videoOnly, "videos"), true);
  assert.equal(isTopicDownloadableForMode(videoOnly, "documents"), false);

  assert.equal(isTopicDownloadableForMode(qualityOnly, "all"), true);
  assert.equal(isTopicDownloadableForMode(qualityOnly, "videos"), true);
  assert.equal(isTopicDownloadableForMode(qualityOnly, "documents"), false);

  assert.equal(isTopicDownloadableForMode(subtitleOnly, "all"), true);
  assert.equal(isTopicDownloadableForMode(subtitleOnly, "videos"), true);
  assert.equal(isTopicDownloadableForMode(subtitleOnly, "documents"), false);

  assert.equal(isTopicDownloadableForMode(documentsOnly, "all"), true);
  assert.equal(isTopicDownloadableForMode(documentsOnly, "videos"), false);
  assert.equal(isTopicDownloadableForMode(documentsOnly, "documents"), true);
});
