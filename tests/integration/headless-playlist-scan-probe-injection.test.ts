import test from "node:test";
import assert from "node:assert/strict";
import {
  type MessageSender,
  EXT_ID,
  stringField,
  probeLessons,
} from "./headless-playlist-scan-types.ts";
import {
  harness,
  makeApiLessons,
  extSender,
  waitForScanReady,
} from "./headless-playlist-scan-setup.ts";

test("Injects page-course-probe.js via chrome.scripting when Tier 1 reports probe-not-ready", async () => {
  harness.reset();
  const sourceTabId = 11;
  const lessons = makeApiLessons(3);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const probeState = { attempts: 0 };

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type !== "probe-playlist-items") return { ok: true };
    probeState.attempts += 1;

    if (probeState.attempts === 1) {
      return { ok: false, reason: "probe-not-ready" };
    }

    queueMicrotask(async () => {
      const sender: MessageSender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: 0,
        url: lessons[0].url,
      };

      const requestId = stringField(message, "requestId");

      for (const item of probeLessons(message)) {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: item.itemIndex,
            stream: {
              mediaUrl: `https://media.example.net/retry-${item.itemIndex}/playlist.m3u8`,
              subtitles: [],
            },
          },
          sender,
        );
      }

      await harness.sendRuntimeMessage(
        {
          type: "playlist-items-probe-done",
          requestId,
          unresolvedIndices: [],
          unresolvedLinks: {},
        },
        sender,
      );
    });

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Inject Test", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 3);
  assert.equal(harness.calls.scriptingExecuted.length, 1);

  assert.deepEqual(harness.calls.scriptingExecuted[0], {
    target: { tabId: sourceTabId },
    files: ["dist/page-playlist-probe.js"],
    world: "MAIN",
  });

  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);
});
