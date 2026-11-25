import test from "node:test";
import assert from "node:assert/strict";
import { fromVmRealm } from "./__mocks__/page-playlist-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-playlist-probe-sandbox.ts";

test("resolves punctuation-sanitized titles, section-scoped duplicate titles, embed SGIDs, tiptap_body posts, and VideoPlayer HTML pages", async () => {
  const courseUrl =
    "https://training.example/c/sample-course/sections/101/lessons/1001";

  const linkedTiptapPostUrl = "https://training.example/c/community/repo-form";

  const linkedPreviewLiveUrl =
    "https://training.example/c/community-events/module-preview";

  const linkedSsrPlayerPostUrl =
    "https://training.example/c/community-events/player-ssr-post";

  const sectionsPayload = {
    records: [
      {
        id: 101,
        name: "Introdução",
        lessons: [
          { id: 1001, name: "Introdução" },
          { id: 1004, name: "Notas, recursos, exemplos" },
        ],
      },
      {
        id: 102,
        name: "Modulo Evolutivo",
        lessons: [
          { id: 1002, name: "Introdução" },
          {
            id: 1005,
            name: "Validação Automatizada — Protegendo Regras de Projeto",
          },
          {
            id: 1006,
            name: "Prévia do Curso: Sistemas Modulares de Exemplo",
          },
          { id: 1007, name: "Aula com Player SSR Linkado" },
        ],
      },
    ],
  };

  const payloadsByPath = new Map<string, Record<string, unknown>>([
    [
      "/internal_api/courses/10/sections/101/lessons/1001",
      {
        id: 1001,
        name: "Introdução",
        featured_media: {
          hls_url: "https://media.example.net/intro-1001/playlist.m3u8",
        },
        rich_text_body: {},
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1002",
      {
        id: 1002,
        name: "Introdução",
        featured_media: {
          hls_url: "https://media.example.net/intro-1002/playlist.m3u8",
        },
        rich_text_body: {},
      },
    ],
    [
      "/internal_api/courses/10/sections/101/lessons/1004",
      {
        id: 1004,
        name: "Notas, recursos, exemplos",
        featured_media: {
          hls_url: "https://media.example.net/1004/playlist.m3u8",
        },
        rich_text_body: {
          sgids_to_object_map: {
            "sgid-form": {
              name: "Formulário Exemplo",
              url: linkedTiptapPostUrl,
            },
          },
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "entity", attrs: { sgid: "sgid-form" } }],
              },
            ],
          },
        },
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1005",
      {
        id: 1005,
        name: "Validação Automatizada — Protegendo Regras de Projeto",
        featured_media: {
          hls_url: "https://media.example.net/1005/playlist.m3u8",
        },
        rich_text_body: {
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Veja ",
                  },
                  {
                    type: "text",
                    text: "Formulario",
                    marks: [
                      { type: "link", attrs: { href: linkedTiptapPostUrl } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1006",
      {
        id: 1006,
        name: "Prévia do Curso: Sistemas Modulares de Exemplo",
        rich_text_body: {
          sgids_to_object_map: {
            "sgid-embed-live": {
              type: "embed",
              title: "Sessões da Comunidade",
              url: linkedPreviewLiveUrl,
            },
          },
          body: {
            type: "doc",
            content: [
              {
                type: "embed",
                attrs: { sgid: "sgid-embed-live" },
              },
            ],
          },
        },
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1007",
      {
        id: 1007,
        name: "Aula com Player SSR Linkado",
        rich_text_body: {
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Abrir evento",
                    marks: [
                      { type: "link", attrs: { href: linkedSsrPlayerPostUrl } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  ]);

  const ssrPlayerProps = JSON.stringify({
    post: {
      name: "Evento SSR",
      body_trix_content: "<p>Post SSR com player JS.</p>",
    },
  }).replace(/"/g, "&quot;");

  const sandbox = createProbeSandbox({
    pageUrl: courseUrl,
    fetchImpl: async (url) => {
      const target = new URL(String(url));
      const jsonPayload = payloadsByPath.get(target.pathname);

      if (jsonPayload) {
        return new Response(JSON.stringify(jsonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.pathname === "/internal_api/courses/10/sections") {
        return new Response(JSON.stringify(sectionsPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.pathname.endsWith("/repo-form")) {
        return new Response(
          JSON.stringify({
            id: 7431525,
            name: "Formulário Exemplo",
            rich_text_body: null,
            tiptap_body: {
              body: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Preencha o formulário." }],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.pathname.endsWith("/module-preview")) {
        return new Response("<html><div>SPA event</div></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      if (target.pathname.endsWith("/player-ssr-post")) {
        return new Response(
          `<html><body><div data-props="${ssrPlayerProps}"></div><div data-component="VideoPlayer"></div></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/courses/10/sections",
  );

  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/courses/10/sections/101/lessons/1001",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  // Verify tiptap_body observation works on community post payloads without rich_text_body.
  const communityTiptapSandbox = createProbeSandbox({
    pageUrl: linkedTiptapPostUrl,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 7431525,
          name: "Formulário Exemplo",
          rich_text_body: null,
          media_settings: {
            video_variants: {
              original: "https://assets.example.net/tiptap-form.mp4",
            },
          },
          tiptap_body: {
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Instruções em tiptap_body." },
                  ],
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await communityTiptapSandbox.windowObj.fetch(
    "https://training.example/internal_api/spaces/501/posts/repo-form",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  assert.ok(
    communityTiptapSandbox.postedMessages.some(
      (entry) =>
        (entry.data as { readonly type?: string })?.type === "playlist-stream",
    ),
  );

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "sidebar-lesson-0",
      title: "1.4 Notas recursos exemplos",
      sectionTitle: "1. Introdução",
      url: courseUrl,
    },
    {
      itemIndex: 1,
      id: "sidebar-lesson-1",
      title: "9.1 Introdução",
      sectionTitle: "9. Modulo Evolutivo",
      url: courseUrl,
    },
    {
      itemIndex: 2,
      id: "sidebar-lesson-2",
      title: "10.5 Validação Automatizada - Protegendo Regras de Projeto",
      sectionTitle: "10. Modulo Evolutivo",
      url: courseUrl,
    },
    {
      itemIndex: 3,
      id: "sidebar-lesson-3",
      title: "13.1 Prévia do Curso - Sistemas Modulares de Exemplo",
      sectionTitle: "13. Modulo Evolutivo",
      url: courseUrl,
    },
    {
      itemIndex: 4,
      id: "sidebar-lesson-4",
      title: "14.1 Aula com Player SSR Linkado",
      sectionTitle: "14. Modulo Evolutivo",
      url: courseUrl,
    },
  ]);

  // Duplicate "Introdução" resolves explicitly to section 102 (1002), NOT 1001.
  assert.equal(
    result.discovered.get(1)?.mediaUrl,
    "https://media.example.net/intro-1002/playlist.m3u8",
  );

  // Sanitized titles resolved their real lesson JSON in Tier 1 without falling into sidebar Tier 1.5!
  assert.equal(
    result.partialLessons.get(0)?.mediaUrl,
    "https://media.example.net/1004/playlist.m3u8",
  );

  assert.equal(
    result.partialLessons.get(2)?.mediaUrl,
    "https://media.example.net/1005/playlist.m3u8",
  );

  // Lesson 1006 resolved embed SGID into Markdown + Tier 1.5 linkedUrl.
  assert.deepEqual(fromVmRealm(result.unresolvedIndices), [0, 2, 3, 4]);
  assert.equal(result.unresolvedLinks["3"], linkedPreviewLiveUrl);

  assert.ok(
    result.partialLessons
      .get(3)
      ?.documents?.markdown.includes(linkedPreviewLiveUrl),
  );

  // SSR HTML with data-component="VideoPlayer" does NOT short-circuit to checked: true.
  assert.equal(result.discovered.has(4), false);
  assert.equal(result.unresolvedLinks["4"], linkedSsrPlayerPostUrl);
});
