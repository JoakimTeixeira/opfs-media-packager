import test from "node:test";
import assert from "node:assert/strict";
import { stringField, EXT_ID } from "./headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./headless-playlist-scan-setup.ts";

test("Tier 1.5 captures 2 direct MP4 event recordings linked from a primary-HLS lesson, extracts Trix materials, and enforces strict 1-hop depth", async () => {
  harness.reset();
  const sourceTabId = 45;

  const parentUrl =
    "https://training.example/c/sample-course/sections/10/lessons/5001";

  const event1Url = "https://training.example/c/community-events/session-alpha";

  const event2Url = "https://training.example/c/community-events/session-beta";

  const lessons = [
    {
      id: "5001",
      url: parentUrl,
      fileTitle: "1.1 O que vai ser construido",
      folderPath: ["(Playlist) Sample Course", "1. Intro"],
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: parentUrl,
    title: "Playlist",
  });

  harness.setFetchHandler(async (url) => {
    if (url.endsWith("playlist.m3u8")) {
      return new Response(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5.0,\nseg0.ts\n#EXT-X-ENDLIST\n",
        { status: 200 },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  const openedFrameUrls: string[] = [];
  const childFinderCalled = { value: false };

  const frameIdByUrl = new Map<string, number>([
    [event1Url, 111],
    [event2Url, 112],
  ]);

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: parentUrl,
      };

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            partial: true,
            stream: {
              url: "",
              mediaUrl: "https://media.example.net/main-5001/playlist.m3u8",
              subtitles: [],
              sourceUrl: parentUrl,
              documents: {
                markdown: [
                  "# 1.1 O que vai ser construido",
                  "",
                  `- [Session 1](${event1Url})`,
                  `- [Session 2](${event2Url})`,
                  "",
                ].join("\n"),
                images: [],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [0],
            unresolvedLinks: { 0: event1Url },
            unresolvedLinkLists: { 0: [event1Url, event2Url] },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const frameId = frameIdByUrl.get(targetUrl) ?? 110;

      openedFrameUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (targetUrl === event1Url) {
          await harness.sendRuntimeMessage(
            {
              type: "page-playlist-stream",
              stream: {
                url: "",
                mediaUrl: "https://assets.example.net/live-event-1.mp4",
              },
            },
            { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
          );
        }
      });

      return { ok: true };
    }

    if (message.type === "collect-direct-video") {
      if (options.frameId === 112) {
        return { url: "https://assets.example.net/live-event-2.mp4" };
      }

      return { url: "" };
    }

    if (message.type === "find-linked-video-in-page") {
      childFinderCalled.value = true;

      return { ok: true, url: event1Url };
    }

    if (message.type === "get-page-heading") {
      return {
        title:
          options.frameId === 111
            ? "Sessao Apresentacao Sistema"
            : "Sessao Continuacao Design",
      };
    }

    if (message.type === "extract-item-documents") {
      if (options.frameId === 111) {
        return {
          documents: {
            markdown: "# Sessao Apresentacao Sistema\n\nResumo sessao 1.\n",
            images: [
              {
                kind: "image",
                url: "https://assets.example.net/session5.jpg",
                filename: "session5.jpg",
              },
            ],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        };
      }

      return {
        documents: {
          markdown: `# Sessao Continuacao Design\n\nVeja a [sessao anterior](${event1Url}).\n`,
          images: [
            {
              kind: "image",
              url: "https://assets.example.net/system-diagram.png",
              filename: "system-diagram.png",
            },
          ],
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
      outline: { title: "Sample Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 1);
  assert.deepEqual(openedFrameUrls, [event1Url, event2Url]);
  assert.equal(childFinderCalled.value, false);
  assert.equal(scan.discovered.length, 1);

  const entry = scan.discovered[0];

  assert.equal(entry.title, "1.1 O que vai ser construido");
  assert.equal(entry.primaryVideoTitle, "1.1 O que vai ser construido");

  assert.equal(entry.url, "https://media.example.net/main-5001/playlist.m3u8");

  assert.equal(entry.extraVideos?.length, 2);

  assert.equal(entry.extraVideos?.[0]?.kind, "direct");

  assert.equal(
    entry.extraVideos?.[0]?.url,
    "https://assets.example.net/live-event-1.mp4",
  );

  assert.equal(entry.extraVideos?.[1]?.kind, "direct");

  assert.equal(
    entry.extraVideos?.[1]?.url,
    "https://assets.example.net/live-event-2.mp4",
  );

  assert.equal(entry.documents?.images.length, 2);
  assert.equal(entry.documents?.extraNotes?.length, 2);
});
