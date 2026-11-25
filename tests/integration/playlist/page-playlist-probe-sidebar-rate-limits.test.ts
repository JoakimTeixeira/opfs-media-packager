import test from "node:test";
import assert from "node:assert/strict";
import { createProbeSandbox } from "./__mocks__/page-playlist-probe-sandbox.ts";

test("shares rate-limit pacing (max 1 in-flight), Retry-After backoff, and 2-strike 429 circuit breaker across sidebar course adapters", async () => {
  const attempts = new Map<string, number>();
  const requestedUrls: string[] = [];
  const flight = { active: 0, max: 0 };

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/101",
    fetchImpl: async (url) => {
      const target = String(url);

      requestedUrls.push(target);
      flight.active += 1;
      flight.max = Math.max(flight.max, flight.active);
      await Promise.resolve();
      const count = (attempts.get(target) || 0) + 1;

      attempts.set(target, count);
      flight.active -= 1;

      if (target.endsWith("/api/sections/10/lessons/101")) {
        return new Response(
          JSON.stringify({
            id: 101,
            media: { hls_url: "https://media.example.net/101/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Transient 429 on Lesson 102 recovers on retry after honoring Retry-After.
      if (target.endsWith("/api/sections/10/lessons/102")) {
        if (count === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "retry-after": "2" },
          });
        }

        return new Response(
          JSON.stringify({
            id: 102,
            media: { hls_url: "https://media.example.net/102/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Persistent 429 on Lesson 103 trips the 2-strike circuit breaker so Lesson 104 is never requested.
      return new Response("Too Many Requests", { status: 429 });
    },
  });

  // Prime the generic lesson API template from the active sidebar lesson.
  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/101",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  requestedUrls.length = 0;

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "102",
      title: "1.2 Transient 429 Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/102",
    },
    {
      itemIndex: 1,
      id: "103",
      title: "1.3 Persistent 429 Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/103",
    },
    {
      itemIndex: 2,
      id: "104",
      title: "1.4 Should Not Be Hammered",
      url: "https://training.example/c/ai/sections/10/lessons/104",
    },
  ]);

  assert.equal(flight.max, 1);
  assert.equal(result.rateLimited, true);

  assert.equal(
    result.discovered.get(0)?.mediaUrl,
    "https://media.example.net/102/master.m3u8",
  );

  assert.deepEqual([...result.unresolvedIndices], [1, 2]);
  assert.ok(sandbox.scheduledDelays.some((delay) => delay >= 1900));

  // Lesson 102 took 2 requests (429 + 200), Lesson 103 took 2 requests (429 + 429 -> tripped),
  // and Lesson 104 was never requested ( nor was any HTML fallback attempted).
  assert.equal(requestedUrls.length, 4);

  assert.equal(
    requestedUrls.some((url) => url.includes("104")),
    false,
  );

  // A 1-lesson batch hitting 429 in fetchGenericLessonPayload must still report
  // rateLimited: true directly without relying on a subsequent queued lesson.
  const singleLessonResult = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "105",
      title: "1.5 Final Lesson 429",
      url: "https://training.example/c/ai/sections/10/lessons/105",
    },
  ]);

  assert.equal(singleLessonResult.rateLimited, true);
  assert.deepEqual([...singleLessonResult.unresolvedIndices], [0]);
});
