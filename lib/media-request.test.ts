import test from "node:test";
import assert from "node:assert/strict";
import { createMediaRequest, fetchDirectMedia } from "./media-request.ts";

test("should create a course media request with its complete source-page referer", () => {
  const request = createMediaRequest({
    mediaUrl: "https://media.example.net/lesson/master.m3u8",
    sourcePageUrl: "https://training.example/courses/course/lesson?chapter=1",
    headers: { Range: "bytes=0-10" },
  });

  assert.deepEqual(request, {
    cache: "no-store",
    credentials: "include",
    redirect: "error",
    headers: { Range: "bytes=0-10" },
    referrer: "https://training.example/courses/course/lesson?chapter=1",
    referrerPolicy: "unsafe-url",
  });

  assert.equal(Object.isFrozen(request), true);
});

test("should omit an invalid source-page referer and keep restrictive defaults", () => {
  const request = createMediaRequest({
    mediaUrl: "https://cdn.example/video.m3u8",
    sourcePageUrl: "file:///private/video",
  });

  assert.deepEqual(request, {
    cache: "no-store",
    credentials: "include",
    redirect: "error",
  });
});

test("should preserve a caller abort signal without treating it as a header", () => {
  const controller = new AbortController();

  const request = createMediaRequest({
    mediaUrl: "https://cdn.example/video.m3u8",
    signal: controller.signal,
  });

  assert.equal(request.signal, controller.signal);
  assert.equal("headers" in request, false);
});

test("fetchDirectMedia retries without credentials on wildcard-CORS failure and blocks unsafe redirects", async () => {
  const controller = new AbortController();
  const seenInits: (RequestInit | undefined)[] = [];

  const mockFetch: typeof fetch = async (_url, init) => {
    seenInits.push(init);

    if (init?.credentials === "include") {
      throw new TypeError("Failed to fetch");
    }

    return new Response("#EXTM3U\n", { status: 200 });
  };

  const okResponse = await fetchDirectMedia(
    {
      mediaUrl: "https://cdn.example/video.m3u8",
      sourcePageUrl: "https://training.example/c/ai/sections/1/lessons/2",
      signal: controller.signal,
      headers: { Range: "bytes=0-99" },
    },
    mockFetch,
  );

  assert.equal(okResponse.status, 200);
  assert.equal(seenInits.length, 2);
  assert.equal(seenInits[0]?.credentials, "include");
  assert.equal(seenInits[0]?.redirect, "error");

  assert.equal(
    seenInits[0]?.referrer,
    "https://training.example/c/ai/sections/1/lessons/2",
  );

  assert.equal(seenInits[1]?.credentials, "omit");
  assert.equal(seenInits[1]?.redirect, "follow");
  assert.equal(seenInits[1]?.cache, "no-store");
  assert.equal(seenInits[1]?.signal, controller.signal);
  assert.deepEqual(seenInits[1]?.headers, { Range: "bytes=0-99" });

  // AbortError must never be swallowed or retried.
  const abortCalls = { count: 0 };

  await assert.rejects(
    () =>
      fetchDirectMedia(
        { mediaUrl: "https://cdn.example/video.m3u8" },
        async () => {
          abortCalls.count += 1;
          throw new DOMException("Aborted", "AbortError");
        },
      ),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );

  assert.equal(abortCalls.count, 1);

  // Non-AbortError DOMException and non-DOMException with name:"AbortError" must still retry with credentials:"omit".
  const nonAbortDom = await fetchDirectMedia(
    { mediaUrl: "https://cdn.example/video.m3u8" },
    async (_url, init) => {
      if (init?.credentials === "include") {
        throw new DOMException("Network failure", "NetworkError");
      }

      return new Response("#EXTM3U\n", { status: 200 });
    },
  );

  assert.equal(nonAbortDom.status, 200);

  const nonDomFakeAbort = await fetchDirectMedia(
    { mediaUrl: "https://cdn.example/video.m3u8" },
    async (_url, init) => {
      if (init?.credentials === "include") {
        throw Object.assign(new TypeError("Failed"), { name: "AbortError" });
      }

      return new Response("#EXTM3U\n", { status: 200 });
    },
  );

  assert.equal(nonDomFakeAbort.status, 200);

  // Fallback redirecting to localhost/private network must be rejected.
  await assert.rejects(
    () =>
      fetchDirectMedia(
        { mediaUrl: "https://cdn.example/video.m3u8" },
        async (_url, init) => {
          if (init?.credentials === "include") {
            throw new TypeError("Redirect blocked");
          }

          const redirected = new Response("secret", { status: 200 });

          Object.defineProperty(redirected, "url", {
            value: "http://127.0.0.1/internal",
          });

          return redirected;
        },
      ),
    /Unsafe redirected media URL/,
  );

  // Safe remote redirect succeeds.
  const safeRedirected = await fetchDirectMedia(
    { mediaUrl: "https://cdn.example/video.m3u8" },
    async (_url, init) => {
      if (init?.credentials === "include") {
        throw new TypeError("CORS");
      }

      const redirected = new Response("#EXTM3U\n", { status: 200 });

      Object.defineProperty(redirected, "url", {
        value: "https://edge.cdn.example/video.m3u8",
      });

      return redirected;
    },
  );

  assert.equal(safeRedirected.status, 200);

  // Unsafe initial URL is rejected before calling fetch.
  await assert.rejects(
    () => fetchDirectMedia({ mediaUrl: "http://127.0.0.1/video.m3u8" }),
    /Unsafe media URL/,
  );
});
