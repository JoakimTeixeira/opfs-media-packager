import type { TiptapNode } from "../topic-markdown.ts";

export const blockTypesDoc: TiptapNode = {
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

export const mixedHtml = `
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

export const markdownEdgeCasesDoc: TiptapNode = {
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
      content: [{ type: "span", content: [{ type: "text", text: "wrapped" }] }],
    },
    { type: "codeBlock" },
    { type: "containerNoContent" },
  ],
};
