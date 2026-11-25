import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateMarkdownWithDownloadedArtifacts,
  cleanItemMarkdown,
  htmlBodyToMarkdown,
  sanitizeMarkdownText,
  stripRelatedContentSections,
  tiptapJsonToMarkdown,
  type TiptapNode,
} from "../lib/item-markdown.ts";
import { canonicalDocumentUrlKey } from "../lib/item-assets.ts";

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

  const alreadyTitled: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "2.4   Feature Design" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Content" }] },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(alreadyTitled, { title: "2.4 Feature Design" }),
    "# 2.4   Feature Design\n\nContent\n",
  );

  const subheadingFirst: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "2.4 Feature Design" }],
      },
    ],
  };

  assert.equal(
    tiptapJsonToMarkdown(subheadingFirst, { title: "2.4 Feature Design" }),
    "# 2.4 Feature Design\n\n## 2.4 Feature Design\n",
  );
});

test("should clamp heading levels 1..6 and accept root content without explicit doc type", () => {
  const doc = {
    content: [
      {
        type: "heading",
        attrs: { level: 0 },
        content: [{ type: "text", text: "Clamped low" }],
      },
      {
        type: "heading",
        attrs: { level: 9 },
        content: [{ type: "text", text: "Clamped high" }],
      },
      {
        type: "heading",
        content: [{ type: "text", text: "Default level" }],
      },
    ],
  };

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
  const doc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Start " },
          { type: "text", text: " bold ", marks: [{ type: "bold" }] },
          { type: "text", text: "strong", marks: [{ type: "strong" }] },
          { type: "text", text: " " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          { type: "text", text: " " },
          { type: "text", text: "em", marks: [{ type: "em" }] },
          { type: "text", text: " " },
          { type: "text", text: "strike", marks: [{ type: "strike" }] },
          { type: "text", text: " " },
          {
            type: "text",
            text: "boldCode",
            marks: [{ type: "bold" }, { type: "code" }],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "`ticked`",
            marks: [{ type: "code" }],
          },
          { type: "text", text: "   ", marks: [{ type: "bold" }] },
          { type: "text", text: "   ", marks: [{ type: "code" }] },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "My ",
            marks: [
              {
                type: "link",
                attrs: { href: "HTTPS://slides.example/deck?slide=1" },
              },
            ],
          },
          {
            type: "text",
            text: "Deck",
            marks: [
              { type: "bold" },
              {
                type: "link",
                attrs: { href: "HTTPS://slides.example/deck?slide=1" },
              },
            ],
          },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "relative",
            marks: [{ type: "link", attrs: { href: "/c/course/doc 1" } }],
          },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "blocked-js",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "blocked-proto-rel",
            marks: [{ type: "link", attrs: { href: "//cdn.example/x" } }],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "blocked-local",
            marks: [
              { type: "link", attrs: { href: "http://127.0.0.1/secret" } },
            ],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "blocked-newline",
            marks: [
              { type: "link", attrs: { href: "https://cdn.example/\nevil" } },
            ],
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "ignored-mark",
            marks: [{ type: "unknownMark" }, { type: 123 }],
          },
        ],
      },
    ],
  };

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
  const doc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Line one " },
                  { type: "hardBreak" },
                  { type: "text", text: " line two" },
                ],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Second paragraph" }],
              },
              {
                type: "orderedList",
                attrs: { start: 3 },
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Third" }],
                      },
                      {
                        type: "bulletList",
                        content: [
                          {
                            type: "listItem",
                            content: [
                              {
                                type: "paragraph",
                                content: [{ type: "text", text: "Grandchild" }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: "listItem",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Fourth" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "List-only item" }],
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
        type: "orderedList",
        attrs: { start: -2 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "One" }] },
            ],
          },
        ],
      },
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Standalone item" }],
          },
        ],
      },
    ],
  };

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
  const doc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Quote A" }] },
          { type: "paragraph", content: [{ type: "text", text: "Quote B" }] },
        ],
      },
      { type: "blockquote", content: [] },
      {
        type: "codeBlock",
        attrs: { language: "ts\n`bad" },
        content: [
          { type: "text", text: "const s = '```';" },
          { type: "hardBreak" },
          { type: "text", text: "console.log(s);\n" },
        ],
      },
      {
        type: "codeBlock",
        attrs: { lang: "bash" },
        content: [{ type: "text", text: "echo ok" }],
      },
      {
        type: "codeBlock",
        content: [{ type: "text", text: "   " }],
      },
      { type: "horizontalRule" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          {
            type: "mention",
            attrs: { label: "Alice" },
            marks: [
              {
                type: "link",
                attrs: { url: "https://training.example/u/alice" },
              },
            ],
          },
          { type: "text", text: " and " },
          { type: "entity", attrs: { title: "Lesson Spec" } },
          { type: "text", text: " and " },
          { type: "unknownInline", attrs: { name: "Bob" } },
          { type: "unknownEmpty" },
        ],
      },
      {
        type: "image",
        attrs: { src: "https://assets.example/diagram.png", alt: "diagram" },
      },
      {
        type: "file",
        attrs: { url: "https://assets.example/guide.pdf" },
      },
      {
        type: "image",
        attrs: {
          src: "https://assets.example/thumb.png",
          caption: "Open Diagram",
          href: "https://excalidraw.com/#json=1",
        },
      },
      {
        type: "image",
        attrs: { src: "https://assets.example/thumb2.png" },
        content: [
          {
            type: "text",
            text: "Caption Link",
            marks: [
              { type: "link", attrs: { href: "https://training.example/ref" } },
            ],
          },
        ],
      },
      {
        type: "image",
        attrs: { src: "https://assets.example/thumb3.png" },
        content: [{ type: "text", text: "Plain unlinked caption" }],
      },
      {
        type: "callout",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Inside callout" }],
          },
        ],
      },
      {
        type: "inlineWrapper",
        content: [{ type: "text", text: "Wrapped inline" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "customInline",
            content: [{ type: "text", text: "Nested inline" }],
          },
          { type: "text" },
        ],
      },
    ],
  };

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
  const html = `
    <!-- ignored comment -->
    <script>const broken = "<h1>Fake</h1>";</script>
    <style>.hidden { display: none; }</style>
    <noscript><p>Enable JS</p></noscript>
    <div data-testid="editor-content-blocks-file-card">
      <div class="card-meta"><span>slides.pdf</span><button>Download</button></div>
    </div>
    <div class="lesson-content">
      <h1>Module Intro</h1>
      <p>Hello &amp; welcome &lt;team&gt; &quot;2026&quot; &#39;ok&#39;&nbsp;&ndash; &#x2019;&#8230;&#0;&#55296;&unknown;</p>
      <p>&nbsp;</p>
      <div class="node-entity">
        <a href="/c/eng/lessons/2?a=1&amp;b=2"><strong>Next</strong> Lesson</a>
      </div>
      <ul>
        <li>First item<br/>\n  continued<li>Second item
          <ol start="5">
            <li>Step five</li>
            <li>Step six</li>
          </ol>
        </li>
        <ul><li>Malformed nested</li></ul>
      </ul>
      <blockquote><p>Wise quote</p></blockquote>
      <pre><code class="language-ts">\nconst x = 1 &lt; 2;\nconst y = x;\n</code></pre>
      <pre data-language="python"><p>print("hi")</p><br><span>done</span></pre>
      <pre><code>   </code></pre>
      <hr/>
      <p>Formatting: <b>bold</b>, <i>italics</i>, <code>fn()</code>, <del>old</del>, <a href="slides.html">Deck</a>, <a name="top">Anchor</a>, <a href="javascript:alert(1)">Bad</a>, <a href="//evil.example/x">ProtoRel</a></p>
      <button type="button">Copy</button>
      <svg><path d="M0 0"/></svg>
      <img src="https://assets.example/pic.png" alt="ignored" />
      <unknown-closing></unknown-closing>
      <div data-testid="editor-content-blocks-file-card" />
    </div>
  `;

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
  const doc: TiptapNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "A",
            marks: [{ type: "link", attrs: { href: "https://cdn.example/a" } }],
          },
          {
            type: "text",
            text: "B",
            marks: [{ type: "link", attrs: { href: "https://cdn.example/b" } }],
          },
          {
            type: "text",
            text: "   ",
            marks: [{ type: "link", attrs: { href: "https://cdn.example/c" } }],
          },
          {
            type: "image",
            attrs: {
              src: "https://assets.example/inline.png",
              caption: "Inline Cap",
              href: "https://training.example/cap",
            },
          },
          { type: 42 },
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
                  { type: "text", text: "Top" },
                  { type: "hardBreak" },
                  { type: "hardBreak" },
                  { type: "text", text: "AfterBlank" },
                ],
              },
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Para2" },
                  { type: "hardBreak" },
                  { type: "hardBreak" },
                  { type: "text", text: "Para2End" },
                ],
              },
            ],
          },
          { type: "listItem" },
        ],
      },
      { type: "bulletList" },
      { type: "orderedList" },
      { type: "blockquote" },
      {
        type: "codeBlock",
        content: [
          { type: "span", content: [{ type: "text", text: "wrapped" }] },
        ],
      },
      { type: "codeBlock" },
      { type: "containerNoContent" },
    ],
  };

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
