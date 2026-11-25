import { test, assert } from "vitest";
import {
  COURSE_ORIGIN,
  stringField,
  EXT_ID,
  type ApiLesson,
  type RuntimeResponse,
  probeLessons,
} from "./__mocks__/headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./__mocks__/headless-playlist-scan-setup.ts";

test("Tier 1.5 discovers linked video via find-linked-video-in-page when Tier 1 provides no pre-known link and rejects forged hidden-probe-frame-ready senders", async () => {
  harness.reset();
  const sourceTabId = 45;
  const playlistUrl = `${COURSE_ORIGIN}/c/ai/sections/1/lessons/10`;
  const discoveredLinkedUrl = `${COURSE_ORIGIN}/c/posts/discovered-workshop`;

  const lessons: readonly ApiLesson[] = [
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.1 Regular Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "1.2 Link-Only Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 1,
    },
    {
      id: "btn-2",
      url: playlistUrl,
      fileTitle: "1.3 Final Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 2,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const securityResults: {
    crossOrigin: RuntimeResponse | undefined;
    wrongTab: RuntimeResponse | undefined;
    topFrame: RuntimeResponse | undefined;
    unknownProbe: RuntimeResponse | undefined;
  } = {
    crossOrigin: undefined,
    wrongTab: undefined,
    topFrame: undefined,
    unknownProbe: undefined,
  };

  const state = {
    findLinkedCalls: 0,
    navigatedPrimaryAway: false,
    openedSibling: false,
  };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
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
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const isLinked = targetUrl === discoveredLinkedUrl;
      const frameId = isLinked ? 88 : 87;

      if (isLinked) state.openedSibling = true;

      queueMicrotask(async () => {
        if (!isLinked) {
          // Probe negative security boundaries BEFORE sending the legitimate ready signal.
          securityResults.crossOrigin = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId },
            {
              id: EXT_ID,
              tab: { id: tabId },
              frameId: 99,
              url: "https://evil.example/c/ai/sections/1/lessons/10",
            },
          );

          securityResults.wrongTab = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId },
            {
              id: EXT_ID,
              tab: { id: tabId + 999 },
              frameId: 99,
              url: targetUrl,
            },
          );

          securityResults.topFrame = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId },
            { id: EXT_ID, tab: { id: tabId }, frameId: 0, url: targetUrl },
          );

          securityResults.unknownProbe = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId: "forged-uuid" },
            { id: EXT_ID, tab: { id: tabId }, frameId: 99, url: targetUrl },
          );
        }

        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (isLinked) {
          harness.emitWebRequest({
            tabId,
            frameId: 88,
            parentFrameId: 0,
            statusCode: 200,
            url: "https://media.example.net/discovered-linked-1/playlist.m3u8",
          });
        }
      });

      return { ok: true };
    }

    if (message.type === "navigate-hidden-probe-frame") {
      state.navigatedPrimaryAway = true;

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === 87
    ) {
      const navIndex = message.itemIndex;

      if (navIndex === 0 || navIndex === 2) {
        queueMicrotask(() => {
          harness.emitWebRequest({
            tabId,
            frameId: 87,
            parentFrameId: 0,
            statusCode: 200,
            url: `https://media.example.net/lesson-${String(navIndex)}/playlist.m3u8`,
          });
        });
      }

      return { ok: true };
    }

    if (
      message.type === "find-linked-video-in-page" &&
      options.frameId === 87
    ) {
      state.findLinkedCalls += 1;

      return { ok: true, url: discoveredLinkedUrl };
    }

    if (message.type === "get-page-heading" && options.frameId === 88) {
      return { title: "Workshop Recording" };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Dynamic Linked Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 5000);

  assert.ok(scan);
  assert.strictEqual(scan.status, "ready");
  assert.strictEqual(securityResults.crossOrigin?.ok, false);
  assert.strictEqual(securityResults.wrongTab?.ok, false);
  assert.strictEqual(securityResults.topFrame?.ok, false);
  assert.strictEqual(securityResults.unknownProbe?.ok, false);
  assert.strictEqual(state.findLinkedCalls, 1);
  assert.strictEqual(state.openedSibling, true);
  assert.strictEqual(state.navigatedPrimaryAway, false);
  assert.strictEqual(scan.discovered.length, 3);

  const linked = scan.discovered.find((item) => item.itemIndex === 1);
  const finalLesson = scan.discovered.find((item) => item.itemIndex === 2);

  assert.strictEqual(linked?.title, "1.2 Workshop Recording");

  assert.strictEqual(
    finalLesson?.url,
    "https://media.example.net/lesson-2/playlist.m3u8",
  );
});
