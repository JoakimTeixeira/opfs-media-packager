import test from "node:test";
import assert from "node:assert/strict";
import { createProbeSandbox } from "./page-playlist-probe-sandbox.ts";

test("extracts transcript webvtt_file_url from player config JSON while ignoring mosaic.vtt storyboards", async () => {
  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/98/lessons/3727",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/98/lessons/3727")) {
        return new Response(
          JSON.stringify({
            id: 3727,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/video-3727/hls/playlist.m3u8",
              },
              preview_thumbnails_url:
                "https://media.example.net/video-3727/mosaic.vtt",
              transcript: {
                id: 3824457,
                enabled: true,
                selected_file: "ai",
                webvtt_file_url:
                  "https://assets.example.net/transcript-3824457",
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
    "https://training.example/api/sections/98/lessons/3727",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "3727",
      title: "1.1 Transcript Lesson",
      url: "https://training.example/c/ai/sections/98/lessons/3727",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  const discovered = result.discovered.get(0);

  assert.equal(
    discovered?.mediaUrl,
    "https://media.example.net/video-3727/hls/playlist.m3u8",
  );

  assert.deepEqual(
    [...(discovered?.subtitles || [])].map((track) => track.url),
    ["https://assets.example.net/transcript-3824457"],
  );
});
