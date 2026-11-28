import { test, assert } from "vitest";
import { syntheticOpaqueAssetUrl } from "../../../lib/materials/__fixtures__/attachment-tokens.ts";
import { fromVmRealm } from "./__mocks__/page-track-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-track-probe-sandbox.ts";

test("should publish space sections outline, fetch paginated attached files, and emit embed video URLs", async () => {
  const pageUrl =
    "https://training.example/c/sample-track/sections/700/lessons/2001";

  const spacePayload = {
    id: 9001,
    name: "Sample Track",
    slug: "sample-track",
    course_sections: [
      {
        id: 700,
        name: "Module One",
        lessons: [
          { id: 2001, name: "Lesson One", content_kind: "lesson" },
          { id: 2002, name: "Lesson Two", content_kind: "lesson" },
        ],
      },
      {
        id: 701,
        name: "Module Two",
        lessons: [{ id: 2003, name: "Assessment", content_kind: "quiz" }],
      },
    ],
  };

  const lesson2001Payload = {
    id: 2001,
    name: "Lesson One",
    featured_media_embed: {
      embed_type: "video",
      content: "https://vimeo.com/900001001?h=abc123",
      html: '<iframe src="https://player.vimeo.com/video/900001001?app_id=990001"></iframe>',
    },
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Lesson one summary." }],
          },
        ],
      },
      inline_attachments: [],
    },
  };

  const lesson2002Payload = {
    id: 2002,
    name: "Lesson Two",
    featured_media_embed: {
      embed_type: "video",
      content: "https://vimeo.com/900001002",
      html: '<iframe src="https://player.vimeo.com/video/900001002?app_id=990001"></iframe>',
    },
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Module notes." }],
          },
        ],
      },
      inline_attachments: [],
    },
  };

  const files2002Page1 = {
    page: 1,
    has_next_page: true,
    records: [
      {
        id: 1,
        filename: "Sample Deck.pptx",
        content_type:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        url: syntheticOpaqueAssetUrl("probe-sample-deck"),
      },
    ],
  };

  const files2002Page2 = {
    page: 2,
    has_next_page: false,
    records: [
      {
        id: 2,
        filename: "Sample Checklist.xlsx",
        content_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        url: syntheticOpaqueAssetUrl("probe-sample-checklist"),
      },
      {
        id: 3,
        filename: "Sample Guide.pdf",
        content_type: "application/pdf",
        url: syntheticOpaqueAssetUrl("probe-sample-guide"),
      },
    ],
  };

  const sandbox = createProbeSandbox({
    pageUrl,
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.includes("/internal_api/spaces/9001")) {
        return new Response(JSON.stringify(spacePayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (
        target.includes("/internal_api/courses/9001/sections/700/lessons/2001")
      ) {
        return new Response(JSON.stringify(lesson2001Payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (
        target.includes("/internal_api/courses/9001/sections/700/lessons/2002")
      ) {
        return new Response(JSON.stringify(lesson2002Payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.includes("/lessons/2001/files")) {
        return new Response(
          JSON.stringify({
            page: 1,
            has_next_page: false,
            records: [
              {
                id: 10,
                filename: "Intro Deck.pptx",
                content_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                url: syntheticOpaqueAssetUrl("probe-intro-deck"),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (
        target.includes("/lessons/2002/files") &&
        new URL(target).searchParams.get("page") === "2"
      ) {
        return new Response(JSON.stringify(files2002Page2), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.includes("/lessons/2002/files")) {
        return new Response(JSON.stringify(files2002Page1), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  // Trigger page-observed space, lesson, and files fetches.
  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/spaces/9001",
  );

  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/courses/9001/sections/700/lessons/2001",
  );

  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/courses/9001/lessons/2001/files?per_page=20&page=1",
  );

  await new Promise((resolve) => setTimeout(resolve, 20));

  const posted = sandbox.postedMessages.map(
    (entry) => fromVmRealm(entry.data) as Record<string, unknown>,
  );

  const outlineMessage = posted.find(
    (entry) => entry.type === "track-outline",
  ) as
    | {
        readonly outline?: {
          readonly title: string;
          readonly items: readonly {
            readonly id: string;
            readonly url: string;
          }[];
        };
      }
    | undefined;

  assert.strictEqual(outlineMessage?.outline?.title, "Sample Track");
  assert.strictEqual(outlineMessage?.outline?.items.length, 3);

  assert.strictEqual(
    outlineMessage?.outline?.items[1]?.url,
    "https://training.example/c/sample-track/sections/700/lessons/2002",
  );

  const streamMessage = posted.find(
    (entry) => entry.type === "track-stream",
  ) as { readonly stream?: { readonly embedUrl?: string } } | undefined;

  assert.strictEqual(
    streamMessage?.stream?.embedUrl,
    "https://player.vimeo.com/video/900001001?h=abc123",
  );

  const pageDocumentsMessages = posted.filter(
    (entry) => entry.type === "page-topic-documents",
  ) as {
    readonly documents?: {
      readonly files?: readonly {
        readonly kind: string;
        readonly filename: string;
      }[];
    };
  }[];

  assert.ok(
    pageDocumentsMessages.some(
      (entry) =>
        entry.documents?.files?.[0]?.kind === "pptx" &&
        entry.documents?.files?.[0]?.filename === "Intro Deck.pptx",
    ),
  );

  // Now run Tier 1 headless batch probe for lesson 2002.
  const batch = await sandbox.runBatchProbe([
    {
      topicIndex: 1,
      id: "2002",
      title: "1.2 Lesson Two",
      sectionTitle: "Module One",
      url: "https://training.example/c/sample-track/sections/700/lessons/2002",
    },
  ]);

  assert.strictEqual(batch.rateLimited, false);
  assert.strictEqual(batch.unresolvedIndices.length, 0);

  const probed = fromVmRealm(batch.discovered.get(1)) as {
    readonly embedUrl?: string;
    readonly documents?: {
      readonly markdown: string;
      readonly pdfs: readonly { readonly filename: string }[];
      readonly files?: readonly {
        readonly kind: string;
        readonly filename: string;
      }[];
    };
  };

  assert.strictEqual(
    probed?.embedUrl,
    "https://player.vimeo.com/video/900001002",
  );

  assert.match(probed?.documents?.markdown || "", /Module notes/);

  assert.deepStrictEqual(
    probed?.documents?.files?.map((file) => ({
      kind: file.kind,
      filename: file.filename,
    })),
    [
      { kind: "pptx", filename: "Sample Deck.pptx" },
      { kind: "xlsx", filename: "Sample Checklist.xlsx" },
    ],
  );

  assert.strictEqual(probed?.documents?.pdfs[0]?.filename, "Sample Guide.pdf");
});
