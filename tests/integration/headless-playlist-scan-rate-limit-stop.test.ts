import test from "node:test";
import assert from "node:assert/strict";
import {
  type MessageSender,
  EXT_ID,
  stringField,
} from "./headless-playlist-scan-types.ts";
import {
  harness,
  makeApiLessons,
  extSender,
  waitForScanReady,
} from "./headless-playlist-scan-setup.ts";

test("Stops immediately on rateLimited:true without escalating to Tier 1.5 hidden iframes or Tier 2 popup windows", async () => {
  harness.reset();
  const sourceTabId = 15;
  const lessons = makeApiLessons(10);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n",
        { status: 200 },
      ),
  );

  const escalation = { hiddenIframeRequested: false };

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type === "open-hidden-probe-frame") {
      escalation.hiddenIframeRequested = true;

      return { ok: true };
    }

    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        const sender: MessageSender = {
          id: EXT_ID,
          tab: { id: tabId },
          frameId: 0,
          url: lessons[0].url,
        };

        const requestId = stringField(message, "requestId");

        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            stream: {
              mediaUrl: "https://media.example.net/partial-0/playlist.m3u8",
              subtitles: [],
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            unresolvedLinks: {},
            rateLimited: true,
          },
          sender,
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Rate Limited Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.rateLimited, true);
  assert.equal(scan.discovered.length, 1);
  assert.equal(escalation.hiddenIframeRequested, false);
  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);
});
