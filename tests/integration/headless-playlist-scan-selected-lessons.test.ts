import test from "node:test";
import assert from "node:assert/strict";
import {
  harness,
  makeApiLessons,
  extSender,
} from "./mocks/headless-playlist-scan-setup.ts";

test("open-course-download filters discovered lessons by selectedItemIndices in course order and rejects empty selection", async () => {
  harness.reset();
  const scanId = "scan-selection-test";

  await harness.chromeMock.storage.session.set({
    [`playlist-scan:${scanId}`]: {
      id: scanId,
      title: "Selection Test",
      lessons: makeApiLessons(3),
      discovered: [
        {
          itemIndex: 2,
          title: "1.3 Third",
          url: "https://media.example.net/3/playlist.m3u8",
        },
        {
          itemIndex: 0,
          title: "1.1 First",
          url: "https://media.example.net/1/playlist.m3u8",
        },
        {
          itemIndex: 1,
          title: "1.2 Second",
          url: "https://media.example.net/2/playlist.m3u8",
        },
      ],
      status: "ready",
    },
  });

  const emptyResult = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, selectedItemIndices: [] },
    extSender,
  );

  assert.match(emptyResult?.error ?? "", /Select at least one item/);

  const okResult = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, selectedItemIndices: [2, 0] },
    extSender,
  );

  assert.equal(okResult?.ok, true);
  const createdUrl = harness.calls.tabsCreated[0].url;
  const playlistDownloadId = new URL(createdUrl).searchParams.get("playlist");

  const taken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId },
    extSender,
  );

  assert.deepEqual(
    taken?.playlistDownload?.items.map((item) => item.itemIndex),
    [0, 2],
  );

  // Completing Lesson 0 persists in session storage so a page reload can
  // resume from Lesson 2 instead of failing with "Course download unavailable".
  const completed = await harness.sendRuntimeMessage(
    {
      type: "complete-playlist-download-item",
      playlistDownloadId,
      itemIndex: 0,
    },
    extSender,
  );

  assert.equal(completed?.ok, true);

  const takenAfterReload = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId },
    extSender,
  );

  assert.deepEqual(
    takenAfterReload?.playlistDownload?.completedItemIndices,
    [0],
  );

  assert.deepEqual(
    takenAfterReload?.playlistDownload?.items.map((item) => item.itemIndex),
    [0, 2],
  );

  // Per-lesson CDN authorization updates DNR rule 910001 for Lesson 2's directory.
  const authorized = await harness.sendRuntimeMessage(
    {
      type: "authorize-download-media",
      url: "https://media.example.net/3/720p/video.m3u8",
      sourceUrl: "https://training.example/c/ai/sections/10/lessons/103",
    },
    extSender,
  );

  assert.equal(authorized?.ok, true);
  assert.ok(harness.calls.dnrAdded.length >= 1);

  const latestRule = harness.calls.dnrAdded.at(-1) as
    { condition?: { urlFilter?: string } } | undefined;

  assert.equal(latestRule?.condition?.urlFilter, "||media.example.net/3/*");
});
