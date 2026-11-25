import test from "node:test";
import assert from "node:assert/strict";
import { fromVmRealm } from "./__mocks__/page-playlist-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-playlist-probe-sandbox.ts";

test("keeps probing 1-hop supplementary event links on lessons that already have a primary HLS video and detects direct MP4 event streams", async () => {
  const live1Url = "https://training.example/c/community-events/session-alpha";

  const live2Url = "https://training.example/c/community-events/session-beta";

  const lessonPayload = {
    id: 5002,
    name: "O que vai ser construido",
    featured_media: {
      hls_url: "https://media.example.net/main-5002/hls/playlist.m3u8",
      webvtt_file_url: "https://training.example/media_transcripts/607349.vtt",
    },
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Lives onde discutimos:" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Live 1",
                        marks: [{ type: "link", attrs: { href: live1Url } }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Live 2",
                        marks: [{ type: "link", attrs: { href: live2Url } }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Proxima aula",
                        marks: [
                          {
                            type: "link",
                            attrs: {
                              href: "https://training.example/c/sample-course/sections/301/lessons/999999",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Conteúdos relacionados" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Related post",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://training.example/c/community-events/related-post",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const sandbox = createProbeSandbox({
    pageUrl:
      "https://training.example/c/sample-course/sections/301/lessons/5001",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/301/lessons/5001")) {
        return new Response(
          JSON.stringify({
            id: 5001,
            media: { hls_url: "https://media.example.net/5001/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/301/lessons/5002")) {
        return new Response(JSON.stringify(lessonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/301/lessons/5001",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "5002",
      title: "1.1 O que vai ser construido",
      url: "https://training.example/c/sample-course/sections/301/lessons/5002",
    },
  ]);

  assert.deepEqual(fromVmRealm(result.unresolvedIndices), [0]);

  assert.deepEqual(fromVmRealm(result.unresolvedLinkLists["0"]), [
    live1Url,
    live2Url,
  ]);

  const partial = result.partialLessons.get(0);

  assert.ok(partial);

  assert.equal(
    partial.mediaUrl,
    "https://media.example.net/main-5002/hls/playlist.m3u8",
  );

  assert.deepEqual(
    fromVmRealm((partial.subtitles || []).map((track) => track.url)),
    ["https://training.example/media_transcripts/607349.vtt"],
  );

  assert.ok(partial.documents?.markdown.includes(live1Url));

  // Event post & media_settings endpoints with direct MP4 variants emit course-stream.
  const eventSandbox = createProbeSandbox({
    pageUrl: live1Url,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 6718622,
          video_variants: {
            hls: null,
            original: "https://assets.example.net/live-event-1.mp4",
          },
          blob_url: "https://assets.example.net/live-event-1.mp4",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await eventSandbox.windowObj.fetch(
    "https://training.example/internal_api/media_settings/blob-event-1",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const directStreamPost = eventSandbox.postedMessages.find(
    (entry) =>
      (entry.data as { readonly type?: string })?.type === "playlist-stream",
  );

  assert.ok(directStreamPost);

  assert.equal(
    (
      directStreamPost.data as {
        readonly stream?: { readonly mediaUrl?: string };
      }
    ).stream?.mediaUrl,
    "https://assets.example.net/live-event-1.mp4",
  );
});
