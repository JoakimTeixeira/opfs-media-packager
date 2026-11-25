import test from "node:test";
import assert from "node:assert/strict";
import {
  harness,
  makeApiLessons,
  extSender,
} from "./mocks/headless-playlist-scan-setup.ts";

test("open-course-download includes materials-only and subtitle-only lessons in default all mode", async () => {
  harness.reset();
  const scanId = "scan-mixed-subsets";

  await harness.chromeMock.storage.session.set({
    [`playlist-scan:${scanId}`]: {
      id: scanId,
      title: "Mixed Content",
      lessons: makeApiLessons(3),
      discovered: [
        {
          itemIndex: 0,
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
          itemIndex: 1,
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
          itemIndex: 2,
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
    { type: "open-playlist-download", scanId, playlistDownloadMode: "videos" },
    extSender,
  );

  assert.equal(videosRes?.ok, true);

  const videosId = new URL(harness.calls.tabsCreated[0].url).searchParams.get(
    "playlist",
  );

  const videosTaken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId: videosId },
    extSender,
  );

  assert.deepEqual(
    videosTaken?.playlistDownload?.items.map((item) => item.itemIndex),
    [1],
  );

  const materialsRes = await harness.sendRuntimeMessage(
    {
      type: "open-playlist-download",
      scanId,
      playlistDownloadMode: "documents",
    },
    extSender,
  );

  assert.equal(materialsRes?.ok, true);

  const materialsId = new URL(
    harness.calls.tabsCreated[1].url,
  ).searchParams.get("playlist");

  const materialsTaken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId: materialsId },
    extSender,
  );

  assert.deepEqual(
    materialsTaken?.playlistDownload?.items.map((item) => item.itemIndex),
    [0],
  );

  const allRes = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, playlistDownloadMode: "all" },
    extSender,
  );

  assert.equal(allRes?.ok, true);

  const allId = new URL(harness.calls.tabsCreated[2].url).searchParams.get(
    "playlist",
  );

  const allTaken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId: allId },
    extSender,
  );

  assert.deepEqual(
    allTaken?.playlistDownload?.items.map((item) => item.itemIndex),
    [0, 1],
  );
});
