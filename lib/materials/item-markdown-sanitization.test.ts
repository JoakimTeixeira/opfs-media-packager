import { test } from "vitest";
import assert from "node:assert/strict";
import {
  annotateMarkdownWithDownloadedArtifacts,
  cleanItemMarkdown,
  htmlBodyToMarkdown,
  sanitizeMarkdownText,
  stripRelatedContentSections,
  tiptapJsonToMarkdown,
  type TiptapNode,
} from "./item-markdown.ts";
import { canonicalDocumentUrlKey } from "./item-assets.ts";

test("should handle empty HTML, unresolvable hrefs, and bare relative paths cleanly", () => {
  assert.equal(htmlBodyToMarkdown(""), "");

  assert.equal(
    htmlBodyToMarkdown("   ", { title: "Empty Title" }),
    "# Empty Title\n",
  );

  assert.equal(
    htmlBodyToMarkdown(
      '<p><a href="/docs/guide">Guide</a> and <a href="local.html">Local</a> and <a href="#sec">Sec</a></p>',
    ),
    "[Guide](/docs/guide) and Local and Sec\n",
  );

  assert.equal(
    htmlBodyToMarkdown('<p><a href="/bad">BadPage</a></p>', {
      pageUrl: "http://localhost/lesson",
    }),
    "[BadPage](/bad)\n",
  );

  assert.equal(
    htmlBodyToMarkdown('<p><a href="sub.html">Sub</a></p>', {
      pageUrl: "http://localhost/lesson",
    }),
    "Sub\n",
  );

  assert.equal(
    htmlBodyToMarkdown(
      '<p>1 < 2</p><p data-empty="true"></p><p><a href="https://cdn.example/ok" title="a > b">Link</a></p>',
    ),
    "1 < 2\n\n[Link](https://cdn.example/ok)\n",
  );

  assert.equal(
    htmlBodyToMarkdown('<p><a href="http://[invalid">BadUrl</a></p>', {
      pageUrl: "https://training.example/lesson",
    }),
    "BadUrl\n",
  );

  assert.equal(
    htmlBodyToMarkdown('<p><a href="/valid" data-x="1">Path</a></p>', {
      pageUrl: "https://training.example/lesson",
    }),
    "[Path](https://training.example/valid)\n",
  );
});

test("should sanitize invisible, surrogate, replacement, variation-selector, and PUA glyphs while preserving valid accents and code tabs", () => {
  const dirty =
    "\uFEFF\uD83DOlá\u200B,\u00A0mundo\uFFFD\uFFFC\u0007\u007F\u0085!\u2028" +
    "\u2029\tTabbed\u000BLine\uFE0F\u{E0100}\u{F0001}👍\uDFFF";

  assert.equal(sanitizeMarkdownText(dirty), "Olá, mundo!\n\n Tabbed Line👍");

  assert.equal(
    sanitizeMarkdownText("a\tb\u200B", { preserveTabs: true }),
    "a\tb",
  );

  assert.equal(sanitizeMarkdownText("\uF0B7 Primeiro item"), "• Primeiro item");

  const pastedBulletsDoc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Links\u200B Úteis\uFE0F" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "•\uFE0F\uFFFC " },
          {
            type: "text",
            text: "https://tool-one.example/",
            marks: [
              {
                type: "link",
                attrs: { href: "https://tool-one.example/" },
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "•\u200B " },
          {
            type: "text",
            text: "https://tool-two.example/",
            marks: [
              { type: "link", attrs: { href: "https://tool-two.example/" } },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "\uF0B7 Normal line" },
          { type: "hardBreak" },
          { type: "text", text: "Second line" },
        ],
      },
      {
        type: "codeBlock",
        content: [{ type: "text", text: "• keep\uFE0F\tindent" }],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(pastedBulletsDoc, { title: "1.1 Aula\u200B" }),
    [
      "# 1.1 Aula",
      "",
      "## Links Úteis",
      "",
      "- [https://tool-one.example/](https://tool-one.example/)",
      "- [https://tool-two.example/](https://tool-two.example/)",
      "",
      "- Normal line  ",
      "Second line",
      "",
      "```",
      "• keep\tindent",
      "```",
      "",
    ].join("\n"),
  );
});

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
