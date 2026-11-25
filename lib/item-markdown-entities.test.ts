import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateMarkdownWithDownloadedArtifacts,
  htmlBodyToMarkdown,
  tiptapJsonToMarkdown,
  type TiptapNode,
} from "./item-markdown.ts";
import { canonicalDocumentUrlKey } from "./item-assets.ts";

test("should resolve TipTap entity sgids and cta nodes, strip video player tags from HTML, and annotate note/video artifacts", () => {
  const entitiesBySgid = new Map([
    [
      "sgid-1",
      {
        title: "Aula de Exemplo",
        url: "https://training.example/c/community/sample-lesson",
      },
    ],
    [
      "sgid-empty-title",
      {
        title: "",
        url: "https://training.example/c/community/sem-titulo",
      },
    ],
    [
      "sgid-embed-yt",
      {
        title: "Sample Tech Talk",
        url: "https://youtu.be/vid33333333?rel=0",
      },
    ],
    [
      "sgid-embed-post",
      {
        title: "Sessões da Comunidade",
        url: "https://training.example/c/events/preview-post",
      },
    ],
  ]);

  const docWithEntitiesAndCta: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "entity", attrs: { sgid: "sgid-1" } },
          { type: "text", text: " e " },
          {
            type: "entity",
            attrs: { sgid: "sgid-missing", label: "Fallback Entity" },
          },
          { type: "text", text: " e " },
          { type: "entity", attrs: { sgid: "sgid-empty-title" } },
        ],
      },
      {
        type: "cta",
        attrs: {
          button_text: "Preencher Feedback",
          url: "https://forms.example/feedback",
        },
      },
      {
        type: "cta",
        attrs: {
          href: "/c/curso/proxima",
        },
      },
      {
        type: "embed",
        attrs: {
          title: "Architecture Video",
          src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
      },
      {
        type: "embed",
        attrs: { sgid: "sgid-embed-yt" },
      },
      {
        type: "embed",
        attrs: { sgid: "sgid-embed-post" },
      },
    ],
  };

  const rendered = tiptapJsonToMarkdown(docWithEntitiesAndCta, {
    title: "3.10 Padrões de Fluxo",
    pageUrl: "https://training.example/c/curso/sections/1/lessons/10",
    entitiesBySgid,
  });

  assert.equal(
    rendered,
    [
      "# 3.10 Padrões de Fluxo",
      "",
      "[Aula de Exemplo](https://training.example/c/community/sample-lesson) e Fallback Entity e [https://training.example/c/community/sem-titulo](https://training.example/c/community/sem-titulo)",
      "",
      "[Preencher Feedback](https://forms.example/feedback)",
      "",
      "[https://training.example/c/curso/proxima](https://training.example/c/curso/proxima)",
      "",
      "[Architecture Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
      "",
      "[Sample Tech Talk](https://youtu.be/vid33333333?rel=0)",
      "",
      "[Sessões da Comunidade](https://training.example/c/events/preview-post)",
      "",
    ].join("\n"),
  );

  const htmlWithPlayer = [
    "<p>Descrição inicial.</p>",
    '<media-theme><media-controller><hls-video><video src="blob:x"><track kind="metadata" src="m.vtt">Player text</video></hls-video></media-controller></media-theme>',
    '<iframe src="https://www.youtube.com/embed/abc123456">Fallback</iframe>',
    '<p>Repo: <a href="https://github.com/org/repo">Repo Link</a></p>',
  ].join("");

  assert.equal(
    htmlBodyToMarkdown(htmlWithPlayer),
    "Descrição inicial.\n\nRepo: [Repo Link](https://github.com/org/repo)\n",
  );

  const parentAnnotated = annotateMarkdownWithDownloadedArtifacts(
    [
      "# 3.10 Padrões de Fluxo",
      "",
      "[Aula Exemplo](https://training.example/c/community/sample-lesson)",
      "",
      "[Anotações](https://training.example/c/community/notes)",
      "",
    ].join("\n"),
    [
      {
        kind: "video",
        url: "https://training.example/c/community/sample-lesson",
        filename: "3.10 Aula Exemplo.mp4",
      },
      {
        kind: "note",
        url: "https://training.example/c/community/sample-lesson",
        filename: "3.10 Aula Exemplo.md",
      },
      {
        kind: "note",
        url: "https://training.example/c/community/notes",
        filename: "3.10 Anotacoes.md",
      },
    ],
    canonicalDocumentUrlKey,
  );

  assert.ok(
    parentAnnotated.includes(
      "[Aula Exemplo](https://training.example/c/community/sample-lesson) — Baixado como `3.10 Aula Exemplo.mp4`",
    ),
  );

  assert.ok(
    parentAnnotated.includes(
      "[Anotações](https://training.example/c/community/notes) — Baixado como `3.10 Anotacoes.md`",
    ),
  );

  assert.ok(
    parentAnnotated.includes(
      "## Arquivos baixados\n\n- Nota: `3.10 Aula Exemplo.md` (baixado)\n",
    ),
  );
});
