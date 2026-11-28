import { test, assert } from "vitest";
import {
  COURSE_ORIGIN,
  type ApiLesson,
  stringField,
  probeLessons,
  EXT_ID,
} from "./__mocks__/headless-track-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./__mocks__/headless-track-scan-setup.ts";

test("Tier 1.5 steps invisibly through sidebar lessons, skips seeded stream on firstRun, probes linked video in temp sibling iframe, and keeps sidebar intact", async () => {
  harness.reset();
  const sourceTabId = 13;
  const playlistUrl = `${COURSE_ORIGIN}/c/engineering/sections/1/lessons/10`;
  const linkedPostUrl = `${COURSE_ORIGIN}/c/posts/live-session`;
  const activeStreamUrl = "https://media.example.net/active-0/playlist.m3u8";

  const lessons: readonly ApiLesson[] = [
    {
      id: "current-topic",
      url: playlistUrl,
      fileTitle: "1.1 Active Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: -1,
    },
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.2 Intro",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "1.3 Linked Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 1,
    },
    {
      id: "btn-2",
      url: playlistUrl,
      fileTitle: "1.4 After Linked",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 2,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Playlist",
  });

  // Seed lesson 0 as already detected in the active tab.
  await harness.chromeMock.storage.session.set({
    [`detections:${sourceTabId}`]: {
      pageUrl: playlistUrl,
      streams: [
        {
          key: "https://media.example.net/active-0/",
          url: activeStreamUrl,
          host: "media.example.net",
          title: "1.1 Active Lesson",
          sourceUrl: playlistUrl,
          kind: "master",
          qualityOptions: [
            {
              url: "https://media.example.net/active-0/720p/video.m3u8",
              label: "720p",
            },
          ],
          subtitles: [
            {
              url: "https://media.example.net/active-0/pt.vtt",
              label: "Portuguese",
              language: "Portuguese",
            },
          ],
          detectedAt: Date.now(),
        },
      ],
      subtitles: [],
    },
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const probeEvents = {
    navigatedPrimaryFrameAway: false,
    openedSiblingFrame: false,
    closedSiblingProbeId: "",
  };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-track-topics") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "track-topics-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.topicIndex),
            unresolvedLinks: { 2: linkedPostUrl },
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
      const isLinked = targetUrl === linkedPostUrl;
      const frameId = isLinked ? 56 : 55;

      if (isLinked) probeEvents.openedSiblingFrame = true;

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (!isLinked) {
          // Initial course page auto-loads active lesson 0 BEFORE sidebar click!
          harness.emitWebRequest({
            tabId,
            frameId: 55,
            parentFrameId: 0,
            statusCode: 200,
            url: activeStreamUrl,
          });
        }

        if (isLinked) {
          harness.emitWebRequest({
            tabId,
            frameId: 56,
            parentFrameId: 0,
            statusCode: 200,
            url: "https://media.example.net/linked-2/playlist.m3u8",
          });
        }
      });

      return { ok: true };
    }

    if (message.type === "close-hidden-probe-frame") {
      probeEvents.closedSiblingProbeId = stringField(message, "probeId");

      return { ok: true };
    }

    if (message.type === "navigate-hidden-probe-frame") {
      probeEvents.navigatedPrimaryFrameAway = true;

      return { ok: true };
    }

    if (message.type === "navigate-track-sidebar" && options.frameId === 55) {
      const navIndex = message.topicIndex;

      queueMicrotask(() => {
        harness.emitWebRequest({
          tabId,
          frameId: 55,
          parentFrameId: 0,
          statusCode: 200,
          url: `https://media.example.net/sidebar-${String(navIndex)}/playlist.m3u8`,
        });
      });

      return { ok: true };
    }

    if (message.type === "get-page-heading" && options.frameId === 56) {
      return { title: "Live Architecture Review" };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-track-scan",
      sourceTabId,
      outline: { title: "Sidebar Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 5000);

  assert.ok(scan);
  assert.strictEqual(scan.status, "ready");
  assert.strictEqual(scan.discovered.length, 4);
  assert.strictEqual(probeEvents.navigatedPrimaryFrameAway, false);
  assert.strictEqual(probeEvents.openedSiblingFrame, true);
  assert.ok(probeEvents.closedSiblingProbeId);

  const firstStepped = scan.discovered.find((item) => item.topicIndex === 1);
  const linked = scan.discovered.find((item) => item.topicIndex === 2);
  const afterLinked = scan.discovered.find((item) => item.topicIndex === 3);

  assert.strictEqual(
    firstStepped?.url,
    "https://media.example.net/sidebar-0/playlist.m3u8",
  );

  assert.strictEqual(linked?.title, "1.3 Live Architecture Review");

  assert.strictEqual(
    afterLinked?.url,
    "https://media.example.net/sidebar-2/playlist.m3u8",
  );

  assert.strictEqual(harness.calls.windowsCreated.length, 0);
  assert.strictEqual(harness.calls.tabsCreated.length, 1);
});
