import test from "node:test";
import assert from "node:assert/strict";
import { encodeDeflatedEnvelope } from "./__mocks__/page-playlist-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-playlist-probe-sandbox.ts";

test("serializes and paces API-route requests (max 1 in-flight) and honors Retry-After on a single 429", async () => {
  const attempts = new Map<string, number>();
  const flight = { active: 0, max: 0 };

  const sandbox = createProbeSandbox({
    fetchImpl: async (url) => {
      flight.active += 1;
      flight.max = Math.max(flight.max, flight.active);
      await Promise.resolve();
      const id = /\/(\d+)\.json/.exec(String(url))?.[1] || "";
      const count = (attempts.get(id) || 0) + 1;

      attempts.set(id, count);
      flight.active -= 1;

      // Single transient 429 with Retry-After header recovers cleanly on retry.
      if (id === "7473" && count === 1) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "retry-after": "3" },
        });
      }

      return new Response(
        encodeDeflatedEnvelope({
          tipo: 7,
          url: `https://media.example.net/video-${id}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const lessons = Array.from({ length: 35 }, (_, index) => ({
    itemIndex: index,
    id: String(7465 + index),
    title: `1.${index + 1} Lesson ${index + 1}`,
    url: `https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=${7465 + index}`,
  }));

  const result = await sandbox.runBatchProbe(lessons);

  assert.equal(flight.max, 1);
  assert.equal(result.rateLimited, false);
  assert.equal(result.unresolvedIndices.length, 0);
  assert.equal(result.discovered.size, 35);

  assert.equal(
    result.discovered.get(34)?.url,
    "https://media.example.net/video-7499",
  );

  // Confirm polite pacing (>=500ms) and Retry-After (3000ms) were scheduled.
  assert.ok(sandbox.scheduledDelays.some((delay) => delay >= 2900));
});
