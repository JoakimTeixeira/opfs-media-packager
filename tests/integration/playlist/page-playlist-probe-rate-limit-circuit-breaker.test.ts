import { test, assert } from "vitest";
import { encodeDeflatedEnvelope } from "./__mocks__/page-playlist-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-playlist-probe-sandbox.ts";

test("trips the 429 circuit breaker on persistent throttling, stops remaining fetches, and skips SPA HTML fallback", async () => {
  const requestedUrls: string[] = [];

  const sandbox = createProbeSandbox({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      const id = /\/(\d+)\.json/.exec(String(url))?.[1] || "";

      if (id === "7465") {
        return new Response(
          encodeDeflatedEnvelope({
            tipo: 7,
            url: "https://media.example.net/video-7465",
          }),
          { status: 200 },
        );
      }

      return new Response("Rate limited", { status: 429 });
    },
  });

  const lessons = Array.from({ length: 10 }, (_, index) => ({
    itemIndex: index,
    id: String(7465 + index),
    title: `1.${index + 1} Lesson ${index + 1}`,
    url: `https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=${7465 + index}`,
  }));

  const result = await sandbox.runBatchProbe(lessons);

  assert.strictEqual(result.rateLimited, true);
  assert.strictEqual(result.discovered.size, 1);
  assert.strictEqual(result.unresolvedIndices.length, 9);
  // Lesson 1 succeeded (1 fetch), lesson 2 failed twice with 429 (2 fetches) -> circuit tripped!
  assert.strictEqual(requestedUrls.length, 3);

  // Never fetched SPA HTML pages after hitting 429.
  assert.strictEqual(
    requestedUrls.some((url) => url.includes("/conteudos")),
    false,
  );
});
