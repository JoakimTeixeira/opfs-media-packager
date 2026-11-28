import { test, assert } from "vitest";
import {
  harness,
  makeApiLessons,
  extSender,
} from "./__mocks__/headless-track-scan-setup.ts";

test("open-course-download includes materials-only and subtitle-only lessons in default all mode", async () => {
  harness.reset();
  const scanId = "scan-mixed-subsets";

  await harness.chromeMock.storage.session.set({
    [`track-scan:${scanId}`]: {
      id: scanId,
      title: "Mixed Content",
      lessons: makeApiLessons(3),
      discovered: [
        {
          topicIndex: 0,
          title: "1.1 Material Only",
          url: "",
          documents: {
            markdown: "# Notes\n",
            images: [],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
        {
          topicIndex: 1,
          title: "1.2 Subtitle Only",
          url: "",
          subtitles: [
            {
              url: "https://media.example.net/1/pt.vtt",
              language: "Portuguese",
              label: "Portuguese",
            },
          ],
        },
        {
          topicIndex: 2,
          title: "1.3 Empty",
          url: "",
          documents: {
            markdown: "",
            images: [],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
      ],
      status: "ready",
    },
  });

  const videosRes = await harness.sendRuntimeMessage(
    { type: "open-track-download", scanId, trackDownloadMode: "videos" },
    extSender,
  );

  assert.strictEqual(videosRes?.ok, true);

  const videosId = new URL(harness.calls.tabsCreated[0].url).searchParams.get(
    "track",
  );

  const videosTaken = await harness.sendRuntimeMessage(
    { type: "take-track-download", trackDownloadId: videosId },
    extSender,
  );

  assert.deepStrictEqual(
    videosTaken?.trackDownload?.items.map((item) => item.topicIndex),
    [1],
  );

  const materialsRes = await harness.sendRuntimeMessage(
    {
      type: "open-track-download",
      scanId,
      trackDownloadMode: "documents",
    },
    extSender,
  );

  assert.strictEqual(materialsRes?.ok, true);

  const materialsId = new URL(
    harness.calls.tabsCreated[1].url,
  ).searchParams.get("track");

  const materialsTaken = await harness.sendRuntimeMessage(
    { type: "take-track-download", trackDownloadId: materialsId },
    extSender,
  );

  assert.deepStrictEqual(
    materialsTaken?.trackDownload?.items.map((item) => item.topicIndex),
    [0],
  );

  const allRes = await harness.sendRuntimeMessage(
    { type: "open-track-download", scanId, trackDownloadMode: "all" },
    extSender,
  );

  assert.strictEqual(allRes?.ok, true);

  const allId = new URL(harness.calls.tabsCreated[2].url).searchParams.get(
    "track",
  );

  const allTaken = await harness.sendRuntimeMessage(
    { type: "take-track-download", trackDownloadId: allId },
    extSender,
  );

  assert.deepStrictEqual(
    allTaken?.trackDownload?.items.map((item) => item.topicIndex),
    [0, 1],
  );
});
