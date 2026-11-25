import test from "node:test";
import assert from "node:assert/strict";
import {
  COURSE_ORIGIN,
  type ApiLesson,
  stringField,
  probeLessons,
  EXT_ID,
} from "./fixtures/headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./fixtures/headless-playlist-scan-setup.ts";

test("Tier 1.5 ignores stale collect-direct-video matching previousStreamKey after sidebar navigation", async () => {
  harness.reset();
  const sourceTabId = 49;
  const playlistUrl = `${COURSE_ORIGIN}/c/sample-course/sections/2/lessons/20`;
  const directVideoUrl = "https://assets.example.net/direct-lesson-21.mp4";

  const lessons: readonly ApiLesson[] = [
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "2.1 Aula Direta",
      folderPath: ["(Playlist) Sample Course", "2. Modulos"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "2.2 Aula Somente Nota",
      folderPath: ["(Playlist) Sample Course", "2. Modulos"],
      navigationIndex: 1,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Sample Course",
  });

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: options.frameId ?? 0,
            url: playlistUrl,
          },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const probeId = stringField(message, "probeId");

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId: 211, url: playlistUrl },
        );
      });

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === 211
    ) {
      if (message.itemIndex === 0) {
        queueMicrotask(async () => {
          await harness.sendRuntimeMessage(
            {
              type: "page-playlist-stream",
              stream: { url: "", mediaUrl: directVideoUrl },
            },
            { id: EXT_ID, tab: { id: tabId }, frameId: 211, url: playlistUrl },
          );
        });
      }

      return { ok: true };
    }

    if (message.type === "collect-direct-video" && options.frameId === 211) {
      return { url: directVideoUrl };
    }

    if (message.type === "extract-item-documents" && options.frameId === 211) {
      return {
        documents: {
          markdown: "# Nota da aula\n",
          images: [],
          pdfs: [],
          diagrams: [],
          slides: [],
        },
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Enterprise", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 2);

  const first = scan.discovered.find((item) => item.itemIndex === 0);
  const second = scan.discovered.find((item) => item.itemIndex === 1);

  assert.equal(first?.url, directVideoUrl);
  assert.equal(second?.url, "");
  assert.equal(second?.qualityOptions?.length, 0);
  assert.equal(second?.documents?.markdown, "# Nota da aula\n");
});
