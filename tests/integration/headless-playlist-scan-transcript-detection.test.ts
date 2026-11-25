import test from "node:test";
import assert from "node:assert/strict";
import { harness, extSender } from "./fixtures/headless-playlist-scan-setup.ts";

test("list-detections recovers eager page transcript VTTs, ignores storyboard mosaic.vtt, and avoids race overwrites with recordPlaylist", async () => {
  harness.reset();
  const tabId = 42;
  const lessonUrl = "https://training.example/c/ai/sections/98/lessons/3727";
  const playlistUrl = "https://media.example.net/video-42/hls/playlist.m3u8";
  const mosaicUrl = "https://media.example.net/video-42/mosaic.vtt";

  const transcriptUrl =
    "https://training.example/media_transcripts/3824457.vtt";

  harness.tabs.set(tabId, {
    id: tabId,
    url: lessonUrl,
    title: "Curso Desenvolvimento com IA",
  });

  // Seed a prior lesson URL so SPA navigation synchronization is exercised.
  await harness.chromeMock.storage.session.set({
    [`detections:${tabId}`]: {
      pageUrl: "https://training.example/c/ai/sections/98/lessons/3726",
      streams: [],
      subtitles: [],
    },
  });

  harness.setFetchHandler(async (input) => {
    const url = String(input);

    if (url === playlistUrl) {
      return new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n",
        { status: 200 },
      );
    }

    if (url === mosaicUrl) {
      return new Response(
        "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nmosaic.jpg#xywh=0,0,160,90\n",
        { status: 200 },
      );
    }

    if (url === transcriptUrl) {
      return new Response(
        "WEBVTT\n\n00:00:00.080 --> 00:00:02.240\nOlá pessoal, você está vendo esta aula sobre desenvolvimento com IA.\n",
        { status: 200 },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  harness.setTabMessageHandler(async (_id, message) => {
    if (message.type === "collect-page-subtitles") {
      return {
        tracks: [
          { url: mosaicUrl, language: "Subtitle", label: "thumbnails" },
          { url: transcriptUrl, language: "Subtitle", label: "" },
        ],
      };
    }

    return { ok: true };
  });

  // Fire playlist + mosaic + transcript concurrently on the new lesson URL.
  harness.emitWebRequest({
    tabId,
    frameId: 0,
    parentFrameId: -1,
    statusCode: 200,
    url: mosaicUrl,
  });

  harness.emitWebRequest({
    tabId,
    frameId: 0,
    parentFrameId: -1,
    statusCode: 200,
    url: playlistUrl,
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 60));

  const listed = (await harness.sendRuntimeMessage(
    { type: "list-detections", tabId },
    extSender,
  )) as {
    readonly streams?: readonly { readonly url: string }[];
    readonly subtitles?: readonly {
      readonly url: string;
      readonly language: string;
    }[];
  };

  assert.equal(listed?.streams?.length, 1);
  assert.equal(listed?.subtitles?.length, 1);
  assert.equal(listed?.subtitles?.[0]?.url, transcriptUrl);
  assert.equal(listed?.subtitles?.[0]?.language, "Portuguese");
});
