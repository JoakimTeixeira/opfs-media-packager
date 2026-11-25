import { test, assert } from "vitest";
import {
  stringField,
  EXT_ID,
} from "./__mocks__/headless-playlist-scan-types.ts";
import {
  harness,
  extSender,
  waitForScanReady,
} from "./__mocks__/headless-playlist-scan-setup.ts";

test("Tier 1.5 stops at 1-hop for linked non-video child posts, skips self/duplicate URLs, and preserves parent lesson title", async () => {
  harness.reset();
  const sourceTabId = 41;

  const parentUrl =
    "https://training.example/c/sample-course/sections/10/lessons/950";

  const childPostUrl =
    "https://training.example/c/community/child-post-materials";

  const lessons = [
    {
      id: "950",
      url: parentUrl,
      fileTitle: "1.3 Linked Non-Video Child",
      folderPath: ["Sample Track", "1. Secao"],
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: parentUrl,
    title: "Playlist",
  });

  const openedFrameUrls: string[] = [];
  const childFinderCalled = { value: false };

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
              mediaUrl: "",
              subtitles: [],
              sourceUrl: parentUrl,
              documents: {
                markdown: [
                  "# 1.3 Linked Non-Video Child",
                  "",
                  "**Vídeo:** [Parent YT](https://www.youtube.com/watch?v=vid11111111)",
                  "",
                  `[Post Extra](${childPostUrl})`,
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
            unresolvedLinks: { 0: childPostUrl },
            unresolvedLinkLists: {
              0: [parentUrl, childPostUrl, `${childPostUrl}/`],
            },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");

      openedFrameUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId: 101, url: targetUrl },
        );
      });

      return { ok: true };
    }

    if (message.type === "find-linked-video-in-page") {
      childFinderCalled.value = true;

      return {
        ok: true,
        url: "https://training.example/c/community/grandchild-loop",
      };
    }

    if (message.type === "get-page-heading") {
      return { title: "Child Non-Video Heading" };
    }

    if (message.type === "extract-item-documents") {
      return {
        documents: {
          markdown:
            "# Child Non-Video Heading\n\nRepo: https://github.com/org/child-materials\n",
          images: [],
          pdfs: [
            {
              kind: "pdf",
              url: "https://assets.example.net/child-handout.pdf",
              filename: "child-handout.pdf",
            },
          ],
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
      outline: { title: "Sample Track", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.strictEqual(scan.status, "ready");
  assert.strictEqual(scan.nextItemIndex, 1);
  assert.deepStrictEqual(openedFrameUrls, [childPostUrl]);
  assert.strictEqual(childFinderCalled.value, false);
  assert.strictEqual(scan.discovered.length, 1);

  const entry = scan.discovered[0];

  assert.strictEqual(entry.title, "1.3 Linked Non - Video Child");
  assert.strictEqual(entry.url, "");

  assert.ok(
    entry.documents?.markdown.includes(
      "https://www.youtube.com/watch?v=vid11111111",
    ),
  );

  assert.strictEqual(entry.documents?.pdfs.length, 1);

  assert.strictEqual(
    entry.documents?.pdfs[0]?.url,
    "https://assets.example.net/child-handout.pdf",
  );

  assert.strictEqual(entry.documents?.extraNotes?.length, 1);

  assert.ok(
    entry.documents?.extraNotes?.[0]?.markdown.includes(
      "https://github.com/org/child-materials",
    ),
  );
});
