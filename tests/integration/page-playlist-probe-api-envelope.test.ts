import test from "node:test";
import assert from "node:assert/strict";
import { encodeDeflatedEnvelope } from "./page-playlist-probe-fixtures.ts";
import { createProbeSandbox } from "./page-playlist-probe-sandbox.ts";

test("captures custom deflated-envelope API template from generic JSON fetch and reuses it across lessons", async () => {
  const requestedUrls: string[] = [];

  const sandbox = createProbeSandbox({
    pageUrl:
      "https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=9001",
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      const id = /(\d+)$/.exec(String(url))?.[1] || "9001";

      return new Response(
        encodeDeflatedEnvelope({
          tipo: 7,
          url: `https://media.example.net/custom-${id}/playlist.m3u8`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  // Simulate the page's own SPA fetching a non-default API endpoint for the active lesson.
  await sandbox.windowObj.fetch("https://training.example/api/v2/items/9001");
  await new Promise<void>((r) => setTimeout(r, 40));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "9002",
      title: "1.2 Second lesson",
      url: "https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=9002",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  assert.equal(
    result.discovered.get(0)?.mediaUrl,
    "https://media.example.net/custom-9002/playlist.m3u8",
  );

  assert.ok(
    requestedUrls.includes("https://training.example/api/v2/items/9002"),
  );
});
