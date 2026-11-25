import test from "node:test";
import assert from "node:assert/strict";
import { fromVmRealm } from "./mocks/page-playlist-probe-fixtures.ts";
import { createProbeSandbox } from "./mocks/page-playlist-probe-sandbox.ts";

test("emits /media_transcripts/<id>.vtt from media_transcript_id with or without webvtt_file_url", async () => {
  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/501",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/501")) {
        return new Response(
          JSON.stringify({
            id: 501,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/501/master.m3u8",
              },
              transcript: {
                media_transcript_id: 4242395,
                enabled: true,
                language: "pt-BR",
                label: "Português",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/502")) {
        return new Response(
          JSON.stringify({
            id: 502,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/502/master.m3u8",
              },
              transcript: {
                media_transcript_id: "4242396",
                enabled: true,
                webvtt_file_url: "",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/503")) {
        return new Response(
          JSON.stringify({
            id: 503,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/503/master.m3u8",
              },
              transcript: {
                media_transcript_id: 4242397,
                enabled: true,
                webvtt_file_url:
                  "https://assets.example.net/transcript-4242397",
                srclang: "en",
                label: "English",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/504")) {
        return new Response(
          JSON.stringify({
            id: 504,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/504/master.m3u8",
              },
              transcript: {
                media_transcript_id: 4242398,
                enabled: false,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/501",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "501",
      title: "1.1 Transcript ID Only",
      url: "https://training.example/c/ai/sections/10/lessons/501",
    },
    {
      itemIndex: 1,
      id: "502",
      title: "1.2 String Transcript ID",
      url: "https://training.example/c/ai/sections/10/lessons/502",
    },
    {
      itemIndex: 2,
      id: "503",
      title: "1.3 Both Candidates",
      url: "https://training.example/c/ai/sections/10/lessons/503",
    },
    {
      itemIndex: 3,
      id: "504",
      title: "1.4 Disabled Transcript",
      url: "https://training.example/c/ai/sections/10/lessons/504",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  assert.deepEqual(fromVmRealm(result.discovered.get(0)?.subtitles), [
    {
      url: "https://training.example/media_transcripts/4242395.vtt",
      language: "pt-BR",
      label: "Português",
    },
  ]);

  assert.deepEqual(
    [...(result.discovered.get(1)?.subtitles || [])].map((track) => track.url),
    ["https://training.example/media_transcripts/4242396.vtt"],
  );

  assert.deepEqual(
    [...(result.discovered.get(2)?.subtitles || [])].map((track) => track.url),
    [
      "https://assets.example.net/transcript-4242397",
      "https://training.example/media_transcripts/4242397.vtt",
    ],
  );

  assert.deepEqual(
    fromVmRealm([...(result.discovered.get(3)?.subtitles || [])]),
    [],
  );
});
