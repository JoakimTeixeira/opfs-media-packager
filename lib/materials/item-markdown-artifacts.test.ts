import { test } from "vitest";
import assert from "node:assert/strict";
import {
  annotateMarkdownWithDownloadedArtifacts,
  stripRelatedContentSections,
} from "./item-markdown-artifacts.ts";
import { canonicalDocumentUrlKey } from "./item-asset-urls.ts";
import {
  cleanItemMarkdown,
  tiptapJsonToMarkdown,
  type TiptapNode,
} from "./item-markdown.ts";

test("should annotate Markdown inline links and non-inline attachments with downloaded or reused filenames", () => {
  assert.equal(
    annotateMarkdownWithDownloadedArtifacts("   ", [], canonicalDocumentUrlKey),
    "   ",
  );

  const md = [
    "# 1.2 Revisao",
    "",
    "## **Slides**",
    "",
    "[Slides do case](https://slides.example/deck/?slide=9)",
    "",
    "Veja o [Diagrama](https://app.excalidraw.com/l/room/1) e [Outro](https://other.example).",
    "",
    "```md",
    "[Slides do case](https://slides.example/deck/?slide=2)",
    "```",
    "",
  ].join("\n");

  const annotated = annotateMarkdownWithDownloadedArtifacts(
    md,
    [
      {
        kind: "slides",
        url: "https://slides.example/deck/?slide=2",
        filename: "1.1 Slides do case.pdf",
        alreadyDownloaded: true,
        folderLabel: "1. Dia 1",
      },
      {
        kind: "diagram",
        url: "https://app.excalidraw.com/l/room/1",
        filename: "1.2 Diagrama.svg",
      },
      {
        kind: "image",
        url: "https://assets.example/rails/active_storage/blobs/redirect/sig1/pic.png",
        fallbackUrl:
          "https://assets.example/rails/active_storage/representations/redirect/sig1/var/pic.png",
        filename: "1.2 Pic.png",
      },
      {
        kind: "pdf",
        url: "https://assets.example/apostila.pdf",
        filename: "1.1 Apostila.pdf",
        alreadyDownloaded: true,
        folderLabel: "1. Dia 1",
      },
      {
        kind: "pdf",
        url: "https://assets.example/apostila.pdf",
        filename: "1.1 Apostila.pdf",
        alreadyDownloaded: true,
        folderLabel: "1. Dia 1",
      },
    ],
    canonicalDocumentUrlKey,
  );

  assert.ok(
    annotated.includes(
      "[Slides do case](https://slides.example/deck/?slide=9) — Já baixado como `1. Dia 1 / 1.1 Slides do case.pdf`",
    ),
  );

  assert.ok(
    annotated.includes(
      "[Diagrama](https://app.excalidraw.com/l/room/1) — Baixado como `1.2 Diagrama.svg`",
    ),
  );

  assert.ok(
    annotated.includes(
      "## Arquivos baixados\n\n- Imagem: `1.2 Pic.png` (baixado)\n- PDF: `1. Dia 1 / 1.1 Apostila.pdf` (já baixado)\n",
    ),
  );

  // Code fence link must stay untouched.
  assert.ok(
    annotated.includes(
      "```md\n[Slides do case](https://slides.example/deck/?slide=2)\n```",
    ),
  );

  // Idempotent when already annotated and all matched inline.
  const onlyInline = annotateMarkdownWithDownloadedArtifacts(
    "[Diagrama](https://app.excalidraw.com/l/room/1) — Baixado como `1.2 Diagrama.svg`\n",
    [
      {
        kind: "diagram",
        url: "https://app.excalidraw.com/l/room/1",
        filename: "1.2 Diagrama.svg",
      },
    ],
    canonicalDocumentUrlKey,
  );

  assert.equal(
    onlyInline,
    "[Diagrama](https://app.excalidraw.com/l/room/1) — Baixado como `1.2 Diagrama.svg`\n",
  );

  assert.equal(cleanItemMarkdown(""), "");

  assert.equal(
    cleanItemMarkdown(
      "•\uFE0F\uFFFC [https://tool-one.example/](https://tool-one.example/)\n```ts\n• keep\tcode\n```\n",
    ),
    "- [https://tool-one.example/](https://tool-one.example/)\n```ts\n• keep\tcode\n```\n",
  );
});

test("should strip Conteúdos relacionados headings and standalone bold link lists while keeping lesson content and code fences", () => {
  assert.equal(stripRelatedContentSections(""), "");

  assert.equal(
    stripRelatedContentSections(
      "## Conteúdos relacionados na comunidade\n\n- [Aula 1](https://training.example/c/x/lessons/1)\n",
    ),
    "",
  );

  const mdWithSections = [
    "# 1.1 Introdução",
    "",
    "Texto principal.",
    "",
    "## **Conteúdos relacionados na plataforma**",
    "",
    "- [Post A](https://training.example/c/x/lessons/10)",
    "",
    "### Subseção relacionada",
    "",
    "- [Post B](https://training.example/c/x/lessons/11)",
    "",
    "## Links finais",
    "",
    "```md",
    "## Conteúdos relacionados",
    "- keep inside code fence",
    "```",
    "",
    "**Conteúdos relacionados**",
    "",
    "- [Post C](https://training.example/c/x/lessons/12)",
    "[Post D](https://training.example/c/x/lessons/13)",
    "",
    "Parágrafo final preservado.",
    "",
  ].join("\n");

  assert.equal(
    stripRelatedContentSections(mdWithSections),
    [
      "# 1.1 Introdução",
      "",
      "Texto principal.",
      "",
      "## Links finais",
      "",
      "```md",
      "## Conteúdos relacionados",
      "- keep inside code fence",
      "```",
      "",
      "Parágrafo final preservado.",
      "",
    ].join("\n"),
  );

  const tiptapWithRelated: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Resumo" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Conteúdo útil." }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          { type: "text", text: "Conteúdos relacionados na plataforma" },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Outro post",
                    marks: [
                      {
                        type: "link",
                        attrs: {
                          href: "https://training.example/c/x/lessons/99",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(tiptapWithRelated),
    "## Resumo\n\nConteúdo útil.\n",
  );
});

test("should annotate linked video and note artifacts", () => {
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
