import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyItemCompanionDocuments,
  extractFeaturedMediaEmbed,
  normalizeEmbeddedVideoUrl,
  withEmbeddedVideoMarkdown,
} from "../lib/item-assets.ts";

test("should normalize embedded video URLs and include videos in lesson Markdown", () => {
  const pageUrl =
    "https://training.example/c/sample-course/sections/10/lessons/20";

  assert.equal(
    normalizeEmbeddedVideoUrl(
      "https://www.youtube-nocookie.com/embed/vid11111111?rel=0",
      pageUrl,
    ),
    "https://www.youtube.com/watch?v=vid11111111",
  );

  assert.equal(
    normalizeEmbeddedVideoUrl("https://player.vimeo.com/video/123", pageUrl),
    "https://player.vimeo.com/video/123",
  );

  assert.equal(normalizeEmbeddedVideoUrl("javascript:alert(1)", pageUrl), null);

  assert.equal(extractFeaturedMediaEmbed(null, pageUrl), null);
  assert.equal(extractFeaturedMediaEmbed({}, pageUrl), null);

  assert.deepEqual(
    extractFeaturedMediaEmbed(
      {
        lesson: {
          featured_media_embed: {
            title: "Sample Workshop",
            html: '<iframe src="https://www.youtube.com/embed/vid11111111?rel=0"></iframe>',
          },
        },
      },
      pageUrl,
    ),
    {
      url: "https://www.youtube.com/watch?v=vid11111111",
      title: "Sample Workshop",
    },
  );

  assert.deepEqual(
    extractFeaturedMediaEmbed(
      {
        post: {
          featured_media_embed: {
            content: "https://youtu.be/vid22222222",
            title: "Streaming Demo",
          },
        },
      },
      pageUrl,
    ),
    {
      url: "https://youtu.be/vid22222222",
      title: "Streaming Demo",
    },
  );

  const empty = emptyItemCompanionDocuments();

  assert.equal(
    withEmbeddedVideoMarkdown(empty, null, "1.5 Intro").markdown,
    "",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      empty,
      { url: "https://www.youtube.com/watch?v=vid11111111" },
      "1.5 Intro",
    ).markdown,
    "# 1.5 Intro\n\n**Vídeo:** [https://www.youtube.com/watch?v=vid11111111](https://www.youtube.com/watch?v=vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      empty,
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
      "",
    ).markdown,
    "**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "# Title\n\nBody text.\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
    ).markdown,
    "# Title\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n\nBody text.\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "# Heading Only\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
    ).markdown,
    "# Heading Only\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Plain body.\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
      "1.5 Fallback",
    ).markdown,
    "# 1.5 Fallback\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n\nPlain body.\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Already [here](https://youtu.be/vid11111111)\n" },
      { url: "https://www.youtube.com/watch?v=vid11111111", title: "Talk" },
    ).markdown,
    "Already [here](https://youtu.be/vid11111111)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      {
        ...empty,
        markdown:
          "Already [here](https://www.youtube.com/watch?v=vid22222222)\n",
      },
      { url: "https://youtu.be/vid22222222", title: "Talk" },
    ).markdown,
    "Already [here](https://www.youtube.com/watch?v=vid22222222)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Embed [here](https://youtu.be/vid22222222)\n" },
      { url: "https://www.youtube.com/embed/vid22222222", title: "Talk" },
    ).markdown,
    "Embed [here](https://youtu.be/vid22222222)\n",
  );

  assert.equal(
    withEmbeddedVideoMarkdown(
      { ...empty, markdown: "Other [v](https://vimeo.com/123)\n" },
      { url: "https://vimeo.com/123", title: "Vimeo" },
    ).markdown,
    "Other [v](https://vimeo.com/123)\n",
  );
});
