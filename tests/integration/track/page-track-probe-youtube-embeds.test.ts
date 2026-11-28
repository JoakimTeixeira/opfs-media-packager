import { test, assert } from "vitest";
import { fromVmRealm } from "./__mocks__/page-track-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-track-probe-sandbox.ts";

test("resolves YouTube embed lessons in Tier 1, preserves partial materials across multi-post entity lessons, extracts disabled transcripts with webvtt_file_url, and reports community media_settings transcripts", async () => {
  const youtubeLessonPayload = {
    id: 801,
    name: "YouTube Technical Talk",
    featured_media: null,
    featured_media_embed: {
      embed_type: "video",
      title: "Streaming Patterns Talk",
      content: "https://youtu.be/vid22222222",
      html: '<iframe src="https://www.youtube.com/embed/vid22222222?rel=0"></iframe>',
    },
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Notes on fan-out patterns." }],
          },
        ],
      },
    },
  };

  const youtubeWithPostPayload = {
    id: 802,
    name: "Sample Workshop",
    featured_media_embed: {
      embed_type: "video",
      title: "Sample Workshop Session",
      html: '<iframe src="https://www.youtube.com/embed/vid11111111?rel=0"></iframe>',
    },
    rich_text_body: {
      sgids_to_object_map: {
        "sgid-es": {
          name: "Workshop Post",
          url: "https://training.example/c/community/sample-workshop-post",
        },
      },
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-es" } }],
          },
        ],
      },
    },
  };

  const multiPostLessonPayload = {
    id: 803,
    name: "Workflow Patterns",
    featured_media: null,
    rich_text_body: {
      inline_attachments: [
        {
          signed_id: "img-pat-1",
          url: "https://assets.example.net/rails/active_storage/blobs/redirect/img1/pat1.png",
          filename: "pattern-banner-1.png",
          content_type: "image/png",
        },
        {
          signed_id: "img-pat-2",
          url: "https://assets.example.net/rails/active_storage/blobs/redirect/img2/pat2.png",
          filename: "pattern-banner-2.png",
          content_type: "image/png",
        },
        {
          signed_id: "img-pat-3",
          url: "https://assets.example.net/rails/active_storage/blobs/redirect/img3/pat3.png",
          filename: "pattern-table.png",
          content_type: "image/png",
        },
      ],
      sgids_to_object_map: {
        "sgid-p1": {
          name: "Reading Group - Patterns",
          url: "https://training.example/c/events/reading-group-patterns",
        },
        "sgid-p2": {
          name: "Sample Lesson Video",
          url: "https://training.example/c/community-lessons/sample-lesson",
        },
        "sgid-p3": {
          name: "Pattern Notes",
          url: "https://training.example/c/notes/pattern-notes",
        },
        "sgid-rel": {
          name: "Relacionado Ignorado",
          url: "https://training.example/c/community-lessons/related-ignored",
        },
      },
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-p1" } }],
          },
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-p2" } }],
          },
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-p3" } }],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Conteúdos relacionados" }],
          },
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-rel" } }],
          },
        ],
      },
    },
  };

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/sample-course/sections/10/lessons/801",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/801")) {
        return new Response(JSON.stringify(youtubeLessonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/802")) {
        return new Response(JSON.stringify(youtubeWithPostPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/803")) {
        return new Response(JSON.stringify(multiPostLessonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/804")) {
        return new Response(
          JSON.stringify({
            id: 804,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/804/master.m3u8",
              },
              transcript: {
                id: 1348709,
                enabled: false,
                selected_file: "ai",
                webvtt_file_url: "https://assets.example.net/ai-1348709",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/c/community/sample-workshop-post")) {
        return new Response("<html><div>SPA post shell</div></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      if (target.includes("/internal_api/media_settings/blob-1")) {
        return new Response(
          JSON.stringify({
            transcript: {
              id: 1348709,
              enabled: false,
              webvtt_file_url:
                "https://assets.example.net/community-ai-sub.vtt",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/801",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      topicIndex: 0,
      id: "801",
      title: "3.4 Streaming Intro",
      url: "https://training.example/c/sample-course/sections/10/lessons/801",
    },
    {
      topicIndex: 1,
      id: "802",
      title: "1.5 Sample Workshop",
      url: "https://training.example/c/sample-course/sections/10/lessons/802",
    },
    {
      topicIndex: 2,
      id: "803",
      title: "3.10 Workflow Patterns",
      url: "https://training.example/c/sample-course/sections/10/lessons/803",
    },
    {
      topicIndex: 3,
      id: "804",
      title: "3.11 AI Subtitle Flag",
      url: "https://training.example/c/sample-course/sections/10/lessons/804",
    },
  ]);

  // YouTube-only lesson resolves in Tier 1 with YouTube link in Markdown.
  const ytOnly = result.discovered.get(0);

  assert.ok(ytOnly?.documents);

  assert.ok(
    ytOnly.documents.markdown.includes(
      "**Vídeo:** [Streaming Patterns Talk](https://youtu.be/vid22222222)",
    ),
  );

  // Disabled AI transcript WITH explicit webvtt_file_url is preserved.
  assert.deepStrictEqual(
    [...(result.discovered.get(3)?.subtitles || [])].map((track) => track.url),
    ["https://assets.example.net/ai-1348709"],
  );

  // Both SPA post + YouTube lesson (802) and multi-post lesson (803) are in unresolvedIndices with partial materials preserved!
  assert.deepStrictEqual(fromVmRealm(result.unresolvedIndices), [1, 2]);

  assert.strictEqual(
    result.unresolvedLinks["1"],
    "https://training.example/c/community/sample-workshop-post",
  );

  assert.ok(
    result.partialLessons
      .get(1)
      ?.documents?.markdown.includes(
        "**Vídeo:** [Sample Workshop Session](https://www.youtube.com/watch?v=vid11111111)",
      ),
  );

  assert.deepStrictEqual(fromVmRealm(result.unresolvedLinkLists["2"]), [
    "https://training.example/c/events/reading-group-patterns",
    "https://training.example/c/community-lessons/sample-lesson",
    "https://training.example/c/notes/pattern-notes",
  ]);

  const multiPartial = result.partialLessons.get(2)?.documents;

  assert.ok(multiPartial);
  assert.strictEqual(multiPartial.images.length, 3);

  assert.ok(
    multiPartial.markdown.includes(
      "[Sample Lesson Video](https://training.example/c/community-lessons/sample-lesson)",
    ),
  );

  // Community post media_settings fetch emits page-subtitle-tracks even when path has no /lessons/<id>.
  const communitySandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/community-lessons/sample-lesson",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          transcript: {
            id: 1348709,
            enabled: false,
            webvtt_file_url: "https://assets.example.net/community-ai-sub.vtt",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await communitySandbox.windowObj.fetch(
    "https://training.example/internal_api/media_settings/blob-1",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const subtitlePost = communitySandbox.postedMessages.find(
    (entry) =>
      (entry.data as { readonly type?: string })?.type ===
      "page-subtitle-tracks",
  );

  assert.ok(subtitlePost);

  assert.deepStrictEqual(
    fromVmRealm(
      (
        subtitlePost.data as {
          readonly tracks: readonly { readonly url: string }[];
        }
      ).tracks.map((track) => track.url),
    ),
    ["https://assets.example.net/community-ai-sub.vtt"],
  );
});
