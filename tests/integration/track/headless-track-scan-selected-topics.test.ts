import { test, assert } from "vitest";
import {
  harness,
  makeApiLessons,
  extSender,
} from "./__mocks__/headless-track-scan-setup.ts";

test("open-course-download filters discovered lessons by selectedTopicIndices in course order and rejects empty selection", async () => {
  harness.reset();
  const scanId = "scan-selection-test";

  await harness.chromeMock.storage.session.set({
    [`track-scan:${scanId}`]: {
      id: scanId,
      title: "Selection Test",
      lessons: makeApiLessons(3),
      discovered: [
        {
          topicIndex: 2,
          title: "1.3 Third",
          url: "https://media.example.net/3/playlist.m3u8",
        },
        {
          topicIndex: 0,
          title: "1.1 First",
          url: "https://media.example.net/1/playlist.m3u8",
        },
        {
          topicIndex: 1,
          title: "1.2 Second",
          url: "https://media.example.net/2/playlist.m3u8",
        },
      ],
      status: "ready",
    },
  });

  const emptyResult = await harness.sendRuntimeMessage(
    { type: "open-track-download", scanId, selectedTopicIndices: [] },
    extSender,
  );

  assert.match(emptyResult?.error ?? "", /Select at least one topic/);

  const okResult = await harness.sendRuntimeMessage(
    { type: "open-track-download", scanId, selectedTopicIndices: [2, 0] },
    extSender,
  );

  assert.strictEqual(okResult?.ok, true);
  const createdUrl = harness.calls.tabsCreated[0].url;
  const trackDownloadId = new URL(createdUrl).searchParams.get("track");

  const taken = await harness.sendRuntimeMessage(
    { type: "take-track-download", trackDownloadId },
    extSender,
  );

  assert.deepStrictEqual(
    taken?.trackDownload?.items.map((item) => item.topicIndex),
    [0, 2],
  );

  // Completing Lesson 0 persists in session storage so a page reload can
  // resume from Lesson 2 instead of failing with "Course download unavailable".
  const completed = await harness.sendRuntimeMessage(
    {
      type: "complete-track-download-topic",
      trackDownloadId,
      topicIndex: 0,
    },
    extSender,
  );

  assert.strictEqual(completed?.ok, true);

  const takenAfterReload = await harness.sendRuntimeMessage(
    { type: "take-track-download", trackDownloadId },
    extSender,
  );

  assert.deepStrictEqual(
    takenAfterReload?.trackDownload?.completedTopicIndices,
    [0],
  );

  assert.deepStrictEqual(
    takenAfterReload?.trackDownload?.items.map((item) => item.topicIndex),
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

  assert.strictEqual(authorized?.ok, true);
  assert.ok(harness.calls.dnrAdded.length >= 1);

  const latestRule = harness.calls.dnrAdded.at(-1) as
    { condition?: { urlFilter?: string } } | undefined;

  assert.strictEqual(
    latestRule?.condition?.urlFilter,
    "||media.example.net/3/*",
  );
});
