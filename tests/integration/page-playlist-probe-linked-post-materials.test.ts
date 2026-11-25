import test from "node:test";
import assert from "node:assert/strict";
import { fromVmRealm } from "./mocks/page-playlist-probe-fixtures.ts";
import { createProbeSandbox } from "./mocks/page-playlist-probe-sandbox.ts";

test("merges single-hop child post video, Markdown, and materials in Tier 1 without fetching grandchild links", async () => {
  const fetchedUrls: string[] = [];

  const parentLessonWithChild = {
    id: 901,
    name: "Parent Lesson",
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Parent summary." }],
          },
          {
            type: "entity",
            attrs: { sgid: "sgid-child" },
          },
        ],
      },
      sgids_to_object_map: {
        "sgid-child": {
          url: "https://training.example/c/course/sections/10/lessons/902",
          title: "Child Video Post",
        },
      },
    },
  };

  const childLessonWithMaterialsAndGrandchild = {
    id: 902,
    name: "Child Video Post",
    featured_media_embed: {
      title: "Architecture Talk",
      html: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Architecture Talk"></iframe>',
    },
    media_settings: {
      video_variants: {
        hls: "https://media.example.net/child-902/master.m3u8",
      },
    },
    rich_text_body: {
      inline_attachments: [
        {
          signed_id: "pdf-child-1",
          url: "https://assets.example.net/child-guide.pdf",
          filename: "child-guide.pdf",
          content_type: "application/pdf",
        },
      ],
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Repo: " },
              {
                type: "text",
                text: "GitHub",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://github.com/org/child-repo" },
                  },
                ],
              },
              { type: "text", text: " and next " },
              {
                type: "text",
                text: "Grandchild Post",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://training.example/c/comunidade/grandchild-never-fetch",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const parentHtmlPost = {
    id: 903,
    name: "HTML Child Lesson",
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Child Community Post",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://training.example/c/comunidade/child-html-only",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const htmlChildDataProps = JSON.stringify({
    post: {
      name: "Community Notes & YouTube",
      featured_media_embed: {
        title: "Child YT",
        content: "https://youtu.be/abc123XYZ00",
      },
      rich_text_body: {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "HTML post body." }],
            },
            {
              type: "embed",
              attrs: {
                src: "https://training.example/c/comunidade/grandchild-never-fetch",
                title: "Nested Grandchild",
              },
            },
          ],
        },
      },
    },
  }).replace(/"/g, "&quot;");

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/course/sections/10/lessons/900",
    fetchImpl: async (url) => {
      const target = String(url);

      fetchedUrls.push(target);

      if (target.endsWith("/api/sections/10/lessons/900")) {
        return new Response(
          JSON.stringify({
            id: 900,
            media: { hls_url: "https://media.example.net/900/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/901")) {
        return new Response(JSON.stringify(parentLessonWithChild), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/902")) {
        return new Response(
          JSON.stringify(childLessonWithMaterialsAndGrandchild),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/903")) {
        return new Response(JSON.stringify(parentHtmlPost), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/c/comunidade/child-html-only")) {
        return new Response(
          `<html><body><div data-props="${htmlChildDataProps}"></div></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/900",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  fetchedUrls.length = 0;

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "901",
      title: "1.1 Linked Api Child",
      url: "https://training.example/c/course/sections/10/lessons/901",
    },
    {
      itemIndex: 1,
      id: "903",
      title: "1.2 Linked Html Child",
      url: "https://training.example/c/course/sections/10/lessons/903",
    },
  ]);

  assert.deepEqual(fromVmRealm(result.unresolvedIndices), []);

  const apiResolved = result.discovered.get(0);

  assert.equal(
    apiResolved?.mediaUrl,
    "https://media.example.net/child-902/master.m3u8",
  );

  assert.equal(apiResolved?.documents?.pdfs.length, 1);

  assert.equal(
    apiResolved?.documents?.pdfs[0]?.url,
    "https://assets.example.net/child-guide.pdf",
  );

  assert.equal(apiResolved?.documents?.extraNotes?.length, 1);

  assert.ok(
    apiResolved?.documents?.extraNotes?.[0]?.markdown.includes(
      "https://github.com/org/child-repo",
    ),
  );

  assert.ok(
    apiResolved?.documents?.extraNotes?.[0]?.markdown.includes(
      "youtube.com/watch?v=dQw4w9WgXcQ",
    ),
  );

  const htmlResolved = result.discovered.get(1);

  assert.equal(htmlResolved?.mediaUrl, "");
  assert.equal(htmlResolved?.documents?.extraNotes?.length, 1);

  assert.ok(
    htmlResolved?.documents?.extraNotes?.[0]?.markdown.includes(
      "youtu.be/abc123XYZ00",
    ),
  );

  assert.equal(
    fetchedUrls.some((url) => url.includes("grandchild-never-fetch")),
    false,
  );
});
