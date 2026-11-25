import test from "node:test";
import assert from "node:assert/strict";
import { encodeDeflatedEnvelope } from "./mocks/page-playlist-probe-fixtures.ts";
import { createProbeSandbox } from "./mocks/page-playlist-probe-sandbox.ts";

test("decodes non-[7,12] video tipo values and rejects HTTP 200 SPA HTML fallbacks as unresolved", async () => {
  const sandbox = createProbeSandbox({
    fetchImpl: async (url) => {
      const id = /\/(\d+)\.json/.exec(String(url))?.[1] || "";

      if (id === "8001") {
        // Non-standard tipo=15 containing a direct UUID video path should still be captured.
        return new Response(
          encodeDeflatedEnvelope({
            tipo: 15,
            url: "https://media.example.net/a1b2c3d4-e5f6-4789-abcd-ef0123456789/playlist.m3u8",
          }),
          { status: 200 },
        );
      }

      if (id === "8002") {
        // HTTP 200 SPA HTML fallback must NOT falsely mark lesson checked!
        return new Response("<!doctype html><html><body>SPA</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      // Valid text-only lesson (valid deflated envelope without video) -> checked with null stream.
      return new Response(
        encodeDeflatedEnvelope({ tipo: 1, texto: "Reading material only" }),
        { status: 200 },
      );
    },
  });

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "8001",
      title: "1.1 Custom tipo video",
      url: "https://training.example/courses/x/1/2/3/conteudos?conteudo=8001",
    },
    {
      itemIndex: 1,
      id: "8002",
      title: "1.2 SPA fallback",
      url: "https://training.example/courses/x/1/2/3/conteudos?conteudo=8002",
    },
    {
      itemIndex: 2,
      id: "8003",
      title: "1.3 Text article",
      url: "https://training.example/courses/x/1/2/3/conteudos?conteudo=8003",
    },
  ]);

  assert.equal(
    result.discovered.get(0)?.mediaUrl,
    "https://media.example.net/a1b2c3d4-e5f6-4789-abcd-ef0123456789/playlist.m3u8",
  );

  assert.deepEqual([...result.unresolvedIndices], [1]);
  assert.equal(result.discovered.has(2), true);
  assert.equal(result.discovered.get(2), null);
});
