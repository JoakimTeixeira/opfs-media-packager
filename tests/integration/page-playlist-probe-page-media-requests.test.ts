import test from "node:test";
import assert from "node:assert/strict";
import { fromVmRealm } from "./mocks/page-playlist-probe-fixtures.ts";
import { createProbeSandbox } from "./mocks/page-playlist-probe-sandbox.ts";

test("fetchMediaFromPage allows subtitle and /media_transcripts paths with appropriate credentials", async () => {
  const fetchCalls: { url: string; credentials?: RequestCredentials }[] = [];

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/701",
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), credentials: init?.credentials });

      return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n", {
        status: 200,
      });
    },
  });

  const requestMedia = (
    url: string,
    responseType: "text" | "bytes",
  ): Promise<{ readonly status: number; readonly body: string }> => {
    const requestId = `media-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {
      sandbox.windowObj.addEventListener("message", (event) => {
        const data = event.data as {
          readonly type?: string;
          readonly requestId?: string;
          readonly response?: {
            readonly status: number;
            readonly body: string;
          };
        };

        if (
          data?.type === "fetch-media-result" &&
          data.requestId === requestId &&
          data.response
        ) {
          resolve(data.response);
        }
      });

      sandbox.windowObj.postMessage(
        {
          source: "opfs-media-packager",
          type: "fetch-media",
          requestId,
          responseType,
          url,
        },
        "https://training.example",
      );
    });
  };

  const sameOrigin = await requestMedia(
    "https://training.example/media_transcripts/4242395.vtt",
    "text",
  );

  assert.equal(sameOrigin.status, 200);
  assert.match(sameOrigin.body, /^WEBVTT/);

  const externalVtt = await requestMedia(
    "https://assets.example.net/tracks/en.vtt",
    "text",
  );

  assert.equal(externalVtt.status, 200);
  assert.match(externalVtt.body, /^WEBVTT/);

  const blocked = await requestMedia(
    "https://training.example/api/sections/10/lessons/701.json",
    "text",
  );

  assert.deepEqual(fromVmRealm(blocked), { status: 0, body: "" });

  const sameOriginBytes = await requestMedia(
    "https://training.example/media_transcripts/4242395",
    "bytes",
  );

  assert.equal(sameOriginBytes.status, 200);

  assert.match(
    Buffer.from(sameOriginBytes.body, "base64").toString("utf8"),
    /^WEBVTT/,
  );

  assert.deepEqual(fetchCalls, [
    {
      url: "https://training.example/media_transcripts/4242395.vtt",
      credentials: "include",
    },
    {
      url: "https://assets.example.net/tracks/en.vtt",
      credentials: "omit",
    },
    {
      url: "https://training.example/media_transcripts/4242395",
      credentials: "include",
    },
  ]);
});
