import { test, assert } from "vitest";
import {
  stringField,
  probeLessons,
  EXT_ID,
} from "./__mocks__/headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  makeApiLessons,
} from "./__mocks__/headless-playlist-scan-setup.ts";

test("Tier 2 fallback opens minimized popup WITHOUT focused property and NEVER falls back to main-window chrome.tabs.create", async () => {
  harness.reset();
  const sourceTabId = 14;
  const lessons = makeApiLessons(2);

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

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type === "probe-playlist-items") {
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
      // Simulate framing blocked -> falls back to Tier 2 minimized popup
      return { ok: false };
    }

    return { ok: true };
  });

  await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Framing Blocked Course", items: lessons },
    },
    extSender,
  );

  // Give async Tier 1 -> Tier 1.5 -> Tier 2 transition a tick to run
  await new Promise<void>((r) => setTimeout(r, 120));
  assert.strictEqual(harness.calls.windowsCreated.length, 1);
  assert.strictEqual(harness.calls.windowsCreated[0].state, "minimized");
  assert.strictEqual(harness.calls.windowsCreated[0].type, "popup");
  assert.strictEqual("focused" in harness.calls.windowsCreated[0], false);
  // Only playlist.html was created via chrome.tabs.create — zero lesson tabs in main window!
  assert.strictEqual(harness.calls.tabsCreated.length, 1);
  assert.match(harness.calls.tabsCreated[0].url, /playlist\.html\?scan=/);
});
