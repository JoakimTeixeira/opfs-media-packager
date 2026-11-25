import test from "node:test";
import assert from "node:assert/strict";
import {
  htmlBodyToMarkdown,
  tiptapJsonToMarkdown,
  type TiptapNode,
} from "../../lib/item-markdown.ts";

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
