import { test, assert } from "vitest";
import {
  type MessageSender,
  EXT_ID,
  stringField,
  probeLessons,
} from "./__mocks__/headless-track-scan-types.ts";
import {
  harness,
  makeApiLessons,
  extSender,
  waitForScanReady,
} from "./__mocks__/headless-track-scan-setup.ts";

test("Tier 1 headless scan resolves all 35 lessons with 0 tabs/windows, retries CORS omit for subtitles, and maps generic Subtitle to language", async () => {
  harness.reset();
  const sourceTabId = 10;
  const lessons = makeApiLessons(35);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(async (url, init) => {
    if (url.endsWith("playlist.m3u8")) {
      return new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480\n480p/video.m3u8\n",
        { status: 200 },
      );
    }

    if (url.endsWith(".vtt")) {
      // Simulate wildcard-ACAO CDN rejecting credentials:"include" and succeeding on "omit".
      if (init?.credentials === "include") {
        throw new TypeError("Failed to fetch");
      }

      return new Response(
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVocê não precisa escolher agora, porque vamos ver tudo.\n",
        { status: 200 },
      );
    }

    return new Response("", { status: 404 });
  });

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type === "probe-track-topics") {
      queueMicrotask(async () => {
        const frameSender: MessageSender = {
          id: EXT_ID,
          tab: { id: tabId },
          frameId: 0,
          url: lessons[0].url,
        };

        const requestId = stringField(message, "requestId");

        for (const item of probeLessons(message)) {
          await harness.sendRuntimeMessage(
            {
              type: "track-topic-probed",
              requestId,
              topicIndex: item.topicIndex,
              stream: {
                url: "",
                mediaUrl: `https://media.example.net/v-${item.topicIndex}/playlist.m3u8`,
                subtitles: [
                  {
                    url: `https://media.example.net/v-${item.topicIndex}/subs.vtt`,
                    label: "Subtitle",
                    language: "Subtitle",
                  },
                ],
              },
            },
            frameSender,
          );
        }

        await harness.sendRuntimeMessage(
          {
            type: "track-topics-probe-done",
            requestId,
            unresolvedIndices: [],
            unresolvedLinks: {},
          },
          frameSender,
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-track-scan",
      sourceTabId,
      outline: { title: "35 Lesson Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.strictEqual(scan.status, "ready");
  assert.strictEqual(scan.discovered.length, 35);
  assert.strictEqual(scan.discovered[0].subtitles[0].language, "Portuguese");
  assert.notStrictEqual(scan.discovered[0].subtitles[0].language, "Subtitle");
  assert.strictEqual(harness.calls.windowsCreated.length, 0);
  // Only track.html tab was opened; zero lesson tabs!
  assert.strictEqual(harness.calls.tabsCreated.length, 1);
  assert.match(harness.calls.tabsCreated[0].url, /track\.html\?scan=/);
});
