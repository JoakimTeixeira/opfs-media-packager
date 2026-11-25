import { test, assert } from "vitest";
import { createProbeSandbox } from "./__mocks__/page-playlist-probe-sandbox.ts";

test("propagates rateLimited explicitly through linked-video HTML resolution without hammering subsequent lessons", async () => {
  const requestedUrls: string[] = [];

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/201",
    fetchImpl: async (url) => {
      const target = String(url);

      requestedUrls.push(target);

      if (target.endsWith("/api/sections/10/lessons/201")) {
        return new Response(
          JSON.stringify({
            id: 201,
            media: { hls_url: "https://media.example.net/201/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/202")) {
        return new Response(
          JSON.stringify({
            id: 202,
            body_html:
              '<a href="https://training.example/c/workshops/rate-limited-live">Live Workshop</a>',
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Linked workshop page responds with persistent 429s.
      return new Response("Too Many Requests", { status: 429 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/201",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  requestedUrls.length = 0;

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "202",
      title: "2.2 Linked Lesson With 429 Target",
      url: "https://training.example/c/ai/sections/10/lessons/202",
    },
    {
      itemIndex: 1,
      id: "203",
      title: "2.3 Must Not Be Requested",
      url: "https://training.example/c/ai/sections/10/lessons/203",
    },
  ]);

  assert.strictEqual(result.rateLimited, true);
  assert.deepStrictEqual([...result.unresolvedIndices], [0, 1]);

  assert.strictEqual(
    requestedUrls.some((url) => url.includes("203")),
    false,
  );
});
