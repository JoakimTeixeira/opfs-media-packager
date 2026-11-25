import test from "node:test";
import assert from "node:assert/strict";
import { fromVmRealm } from "./fixtures/page-playlist-probe-fixtures.ts";
import { createProbeSandbox } from "./fixtures/page-playlist-probe-sandbox.ts";

test("extracts rich_text_body materials for video and materials-only lessons", async () => {
  const richTextPayload = {
    inline_attachments: [
      {
        signed_id: "sig-pdf-601",
        url: "https://assets.example.net/pdf-blob",
        filename: "architecture-guide.pdf",
        content_type: "application/pdf",
      },
      {
        signed_id: "sig-img-601",
        url: "https://assets.example.net/rails/active_storage/representations/redirect/sig-img-601/large/diagram.png",
        filename: "diagram.png",
        content_type: "image/png",
        image_variants: {
          original: "https://assets.example.net/originals/diagram.png",
          large: "https://assets.example.net/large/diagram.png",
        },
      },
    ],
    body: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Key Takeaways" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Top item" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Nested item" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            {
              type: "text",
              text: "Reference",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://training.example/docs/reference" },
                },
              ],
            },
            { type: "text", text: ", " },
            {
              type: "text",
              text: "System Diagram",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://app.excalidraw.com/s/arch-map" },
                },
              ],
            },
            { type: "text", text: ", and " },
            {
              type: "text",
              text: "Architecture Deck",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://slides.example/architecture?slide=9",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/601",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/601")) {
        return new Response(
          JSON.stringify({
            id: 601,
            name: "Materials Only Lesson",
            rich_text_body: richTextPayload,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/602")) {
        return new Response(
          JSON.stringify({
            id: 602,
            name: "Video And Materials Lesson",
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/602/master.m3u8",
              },
            },
            rich_text_body: richTextPayload,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  // Active lesson 601 has no video stream, only rich_text_body; template must still be captured.
  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/601",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "601",
      title: "1.1 Materials Only Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/601",
    },
    {
      itemIndex: 1,
      id: "602",
      title: "1.2 Video And Materials Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/602",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  const materialsOnly = result.discovered.get(0);

  assert.equal(materialsOnly?.url, "");
  assert.equal(materialsOnly?.mediaUrl, "");
  assert.ok(materialsOnly?.documents);

  assert.match(
    materialsOnly.documents.markdown,
    /^# 1\.1 Materials Only Lesson\n\n## Key Takeaways\n\n- Top item\n {2}- Nested item\n\nRead \[Reference\]\(https:\/\/training\.example\/docs\/reference\)/,
  );

  assert.deepEqual(fromVmRealm(materialsOnly.documents.pdfs), [
    {
      kind: "pdf",
      url: "https://assets.example.net/pdf-blob",
      filename: "architecture-guide.pdf",
      contentType: "application/pdf",
    },
  ]);

  assert.deepEqual(fromVmRealm(materialsOnly.documents.images), [
    {
      kind: "image",
      url: "https://assets.example.net/originals/diagram.png",
      fallbackUrl:
        "https://assets.example.net/rails/active_storage/representations/redirect/sig-img-601/large/diagram.png",
      filename: "diagram.png",
      contentType: "image/png",
    },
  ]);

  assert.deepEqual(fromVmRealm(materialsOnly.documents.diagrams), [
    {
      kind: "diagram",
      url: "https://app.excalidraw.com/s/arch-map",
      title: "System Diagram",
    },
  ]);

  assert.deepEqual(fromVmRealm(materialsOnly.documents.slides), [
    {
      kind: "slides",
      url: "https://slides.example/architecture?slide=9",
      title: "Architecture Deck",
    },
  ]);

  const videoAndMaterials = result.discovered.get(1);

  assert.equal(
    videoAndMaterials?.mediaUrl,
    "https://media.example.net/602/master.m3u8",
  );

  assert.ok(videoAndMaterials?.documents);

  assert.match(
    videoAndMaterials.documents.markdown,
    /^# 1\.2 Video And Materials Lesson\n/,
  );

  assert.equal(videoAndMaterials.documents.pdfs.length, 1);
  assert.equal(videoAndMaterials.documents.images.length, 1);
  assert.equal(videoAndMaterials.documents.diagrams.length, 1);
  assert.equal(videoAndMaterials.documents.slides.length, 1);
});
