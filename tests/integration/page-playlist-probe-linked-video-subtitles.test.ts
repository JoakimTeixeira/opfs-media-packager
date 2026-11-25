import test from "node:test";
import assert from "node:assert/strict";
import { createProbeSandbox } from "./page-playlist-probe-sandbox.ts";

test("extracts deep subtitles via BFS and resolves linked video post with its own title", async () => {
  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/101",
    domProps: [
      {
        sections: [
          {
            id: 10,
            lessons: [
              { id: 101, name: "1.1 Active", section_id: 10 },
              { id: 102, name: "1.2 Linked Workshop", section_id: 10 },
            ],
          },
        ],
      },
    ],
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/101")) {
        return new Response(
          JSON.stringify({
            id: 101,
            media: {
              hls_url: "https://media.example.net/101/master.m3u8",
              nested: {
                captions: [
                  {
                    vtt_url: "https://media.example.net/101/pt.vtt",
                    language: "pt-BR",
                    label: "Português",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/102")) {
        return new Response(
          JSON.stringify({
            id: 102,
            body_html:
              '<p>Watch here: <a href="https://training.example/c/workshops/architecture-live">Workshop</a></p>',
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/c/workshops/architecture-live")) {
        return new Response(
          '<!doctype html><html><head><title>Architecture Live Session | Portal</title></head><body><script>var u="https://media.example.net/workshop/playlist.m3u8"; var s="https://media.example.net/workshop/en.vtt";</script></body></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/101",
  );

  await new Promise<void>((r) => setTimeout(r, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "101",
      title: "1.1 Active",
      url: "https://training.example/c/ai/sections/10/lessons/101",
    },
    {
      itemIndex: 1,
      id: "102",
      title: "1.2 Linked Workshop",
      url: "https://training.example/c/ai/sections/10/lessons/102",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  assert.equal(
    result.discovered.get(0)?.subtitles?.[0]?.url,
    "https://media.example.net/101/pt.vtt",
  );

  assert.equal(
    result.discovered.get(1)?.mediaUrl,
    "https://media.example.net/workshop/playlist.m3u8",
  );

  assert.equal(
    result.discovered.get(1)?.linkedTitle,
    "Architecture Live Session",
  );
});
