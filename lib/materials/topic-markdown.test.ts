import {
  alreadyTitled,
  subheadingFirst,
} from "./__fixtures__/markdown-headings.ts";
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  tiptapJsonToMarkdown,
  type TiptapNode,
  htmlBodyToMarkdown,
  sanitizeMarkdownText,
} from "./topic-markdown.ts";
import {
  headingDoc,
  inlineFormattingDoc,
  nestedListsDoc,
} from "./__fixtures__/markdown-rendering.ts";
import {
  blockTypesDoc,
  mixedHtml,
  markdownEdgeCasesDoc,
} from "./__fixtures__/markdown-html.ts";
import {
  entityReferences,
  entityAndCtaDoc,
} from "./__fixtures__/markdown-entities.ts";
import { pastedBulletDoc } from "./__fixtures__/markdown-bullets.ts";

test("should return empty string for missing, empty, or whitespace-only TipTap docs without title", () => {
  assert.equal(tiptapJsonToMarkdown(null), "");
  assert.equal(tiptapJsonToMarkdown(undefined), "");
  assert.equal(tiptapJsonToMarkdown("not-a-doc"), "");
  assert.equal(tiptapJsonToMarkdown({ type: "doc" }), "");

  assert.equal(
    tiptapJsonToMarkdown({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   \t  " }] },
        { type: "heading", attrs: { level: 2 }, content: [] },
      ],
    }),
    "",
  );
});

test("should prepend title only when missing or different at top of document", () => {
  assert.equal(tiptapJsonToMarkdown(null, { title: "   " }), "");

  assert.equal(
    tiptapJsonToMarkdown(null, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n",
  );

  const withParagraph: TiptapNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Body text." }] },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(withParagraph, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n\nBody text.\n",
  );

  assert.equal(
    tiptapJsonToMarkdown(alreadyTitled, { title: "2.4 Feature Design" }),
    "# 2.4   Feature Design\n\nContent\n",
  );

  assert.equal(
    tiptapJsonToMarkdown(subheadingFirst, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n\n## 2.4 Feature Design\n",
  );
});

test("should clamp heading levels 1..6 and accept root content without explicit doc type", () => {
  const doc = headingDoc;

  assert.equal(
    tiptapJsonToMarkdown(doc),
    "# Clamped low\n\n###### Clamped high\n\n# Default level\n",
  );

  assert.equal(
    tiptapJsonToMarkdown({
      type: "paragraph",
      content: [{ type: "text", text: "Single node" }],
    }),
    "Single node\n",
  );
});

test("should render inline marks with proper precedence, space preservation, and safe links", () => {
  const doc: TiptapNode = inlineFormattingDoc;

  assert.equal(
    tiptapJsonToMarkdown(doc),
    [
      "Start  **bold** **strong** *italic* *em* ~~strike~~ **`boldCode`** `` `ticked` ``      ",
      "",
      "[My **Deck**](https://slides.example/deck?slide=1) and [relative](/c/course/doc%201) and blocked-js blocked-proto-rel blocked-local blocked-newline ignored-mark",
      "",
    ]
      .join("\n")
      .replace(/ {6}\n/, "\n"),
  );
});

test("should render nested bullet/ordered lists, start offset, multi-paragraph items, and hardBreaks", () => {
  const doc: TiptapNode = nestedListsDoc;

  assert.equal(
    tiptapJsonToMarkdown(doc),
    [
      "- Line one  ",
      "  line two",
      "",
      "  Second paragraph",
      "  3. Third",
      "    - Grandchild",
      "  4. Fourth",
      "-",
      "  - List-only item",
      "",
      "1. One",
      "",
      "- Standalone item",
      "",
    ].join("\n"),
  );
});

test("should render blockquotes, fenced codeBlocks, horizontalRules, mentions, and skip media unless caption-linked", () => {
  const doc: TiptapNode = blockTypesDoc;

  assert.equal(
    tiptapJsonToMarkdown(doc),
    [
      "> Quote A",
      ">",
      "> Quote B",
      "",
      "````tsbad",
      "const s = '```';",
      "console.log(s);",
      "````",
      "",
      "```bash",
      "echo ok",
      "```",
      "",
      "---",
      "",
      "See [Alice](https://training.example/u/alice) and Lesson Spec and Bob",
      "",
      "[Open Diagram](https://excalidraw.com/#json=1)",
      "",
      "[Caption Link](https://training.example/ref)",
      "",
      "Inside callout",
      "",
      "Wrapped inline",
      "",
      "Nested inline",
      "",
    ].join("\n"),
  );
});

test("should convert HTML bodies cleanly without DOM while stripping scripts, styles, buttons, and file cards", () => {
  const html = mixedHtml;

  assert.equal(
    htmlBodyToMarkdown(html, {
      title: "1.1 Module Intro",
      pageUrl: "https://training.example/c/eng/sections/s1/lessons/1",
    }),
    [
      "# 1.1 Module Intro",
      "",
      "# Module Intro",
      "",
      "Hello & welcome <team> \"2026\" 'ok' – ’…&#0;&#55296;&unknown;",
      "",
      "[**Next** Lesson](https://training.example/c/eng/lessons/2?a=1&b=2)",
      "",
      "- First item  ",
      "  continued",
      "- Second item",
      "  5. Step five",
      "  6. Step six",
      "  - Malformed nested",
      "",
      "> Wise quote",
      "",
      "```ts",
      "const x = 1 < 2;",
      "const y = x;",
      "```",
      "",
      "```python",
      'print("hi")',
      "",
      "done",
      "```",
      "",
      "---",
      "",
      "Formatting: **bold**, *italics*, `fn()`, ~~old~~, [Deck](https://training.example/c/eng/sections/s1/lessons/slides.html), Anchor, Bad, ProtoRel",
      "",
    ].join("\n"),
  );
});

test("should cover edge branches across inline marks, lists, codeBlocks, and HTML attributes", () => {
  const doc: TiptapNode = markdownEdgeCasesDoc;

  assert.equal(
    tiptapJsonToMarkdown(doc),
    [
      "[A](https://cdn.example/a)[B](https://cdn.example/b)   [Inline Cap](https://training.example/cap)",
      "",
      "- Top  ",
      "",
      "  AfterBlank",
      "",
      "  Para2  ",
      "",
      "  Para2End",
      "",
      "```",
      "wrapped",
      "```",
      "",
    ].join("\n"),
  );

  assert.equal(
    htmlBodyToMarkdown(
      `<ol start=2><li>Two</li></ol><ol><li>One</li></ol><ul><ul><li>NoParent</li></ul><ol><li>DirectOl</li></ol></ul><pre class='lang-js'><span>x = 1</span></pre><pre></pre><p><a href='https://cdn.example/single' data-flag>Single</a></p>`,
    ),
    [
      "2. Two",
      "",
      "1. One",
      "",
      "```js",
      "x = 1",
      "```",
      "",
      "[Single](https://cdn.example/single)",
      "",
    ].join("\n"),
  );
});

test("should render linked TipTap entities and remove embedded video players from HTML", () => {
  const entitiesBySgid = entityReferences;

  const docWithEntitiesAndCta: TiptapNode = entityAndCtaDoc;

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
});

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

  const pastedBulletsDoc: TiptapNode = pastedBulletDoc;

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
