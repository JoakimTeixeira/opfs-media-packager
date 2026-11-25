import test from "node:test";
import assert from "node:assert/strict";
import {
  type MessageSender,
  EXT_ID,
  stringField,
  probeLessons,
} from "./mocks/headless-playlist-scan-types.ts";
import {
  harness,
  makeApiLessons,
  extSender,
  waitForScanReady,
} from "./mocks/headless-playlist-scan-setup.ts";

test("Tier 1.5 invisible same-origin iframe captures nested player iframe via parentFrameId without polluting main tab, then escalates remaining 34 lessons", async () => {
  harness.reset();
  const sourceTabId = 12;
  const lessons = makeApiLessons(35);

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

  const iframeState = { closedProbeId: "" };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (
      message.type === "probe-playlist-items" &&
      (options.frameId ?? 0) === 0
    ) {
      // Main tab has not captured the API template yet: return all 35 unresolved.
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          { id: EXT_ID, tab: { id: tabId }, frameId: 0, url: lessons[0].url },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const hiddenFrameId = 42;

      queueMicrotask(async () => {
        // Hidden iframe signals ready at document_start -> observer arms synchronously!
        await harness.sendRuntimeMessage(
          {
            type: "hidden-probe-frame-ready",
            probeId: stringField(message, "probeId"),
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: hiddenFrameId,
            url: stringField(message, "url"),
          },
        );

        // Nested video player iframe (frameId 99, parentFrameId 42) loads .m3u8!
        harness.emitWebRequest({
          tabId,
          frameId: 99,
          parentFrameId: hiddenFrameId,
          statusCode: 200,
          url: "https://media.example.net/lesson-0/playlist.m3u8",
        });
      });

      return { ok: true };
    }

    if (message.type === "probe-playlist-items" && options.frameId === 42) {
      // Escalated parallel fetch inside hidden iframe resolves lessons 1..34!
      queueMicrotask(async () => {
        const frameSender: MessageSender = {
          id: EXT_ID,
          tab: { id: tabId },
          frameId: 42,
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
                mediaUrl: `https://media.example.net/escalated-${item.itemIndex}/playlist.m3u8`,
                subtitles: [],
              },
            },
            frameSender,
          );
        }

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [],
            unresolvedLinks: {},
          },
          frameSender,
        );
      });

      return { ok: true };
    }

    if (message.type === "close-hidden-probe-frame") {
      iframeState.closedProbeId = stringField(message, "probeId");

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Tier 1.5 Escalation Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 35);

  assert.ok(
    iframeState.closedProbeId,
    "Hidden probe iframe should be closed after scan",
  );

  // Zero new windows and zero lesson tabs opened!
  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);

  // Main tab popup detections were NOT polluted by the hidden iframe!
  assert.equal(
    harness.sessionStore.get(`detections:${sourceTabId}`),
    undefined,
  );
});
