import test from "node:test";
import assert from "node:assert/strict";
import {
  isSameSiteHost,
  isSupplementaryLinkedPostUrl,
  scoreLinkedVideoUrl,
} from "../../lib/linked-video.ts";

const currentLesson =
  "https://training.example.com.br/c/course/sections/1/lessons/10";

test("should recognize hosts sharing the same registrable site domain", () => {
  assert.equal(
    isSameSiteHost("app.training.example.com.br", "training.example.com.br"),
    true,
  );

  assert.equal(isSameSiteHost("a.example.com", "b.example.com"), true);
  assert.equal(isSameSiteHost("example.com", "other.com"), false);
  assert.equal(isSameSiteHost("localhost", "localhost"), false);
});

test("should rank video embeds and same-site lesson posts above unrelated links", () => {
  assert.equal(
    scoreLinkedVideoUrl("https://player.vimeo.com/video/12345", currentLesson),
    35,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://cdn.other.example/embed/video-1",
      currentLesson,
    ),
    32,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://training.example.com.br/c/course/sections/2/lessons/99",
      currentLesson,
    ),
    30,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://training.example.com.br/c/workshops/live-session",
      currentLesson,
    ),
    25,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://training.example.com.br/posts/recording-1",
      currentLesson,
    ),
    18,
  );

  assert.equal(
    scoreLinkedVideoUrl("https://training.example.com.br/about", currentLesson),
    0,
  );
});

test("should reject same-page links, static assets, account routes, and unsafe URLs", () => {
  assert.equal(scoreLinkedVideoUrl(currentLesson, currentLesson), 0);

  assert.equal(
    scoreLinkedVideoUrl(
      "https://training.example.com.br/img.png",
      currentLesson,
    ),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://training.example.com.br/settings/profile",
      currentLesson,
    ),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl("http://insecure.example/video", currentLesson),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl("https://user:pass@vimeo.com/123", currentLesson),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl("https://other.example/posts/1", currentLesson),
    0,
  );

  assert.equal(scoreLinkedVideoUrl("not a url", "not a url"), 0);

  assert.equal(
    scoreLinkedVideoUrl(
      "https://www.youtube.com/embed/vid11111111?rel=0",
      currentLesson,
    ),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://m.youtube.com/watch?v=vid44444444",
      currentLesson,
    ),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl("https://youtu.be/vid22222222", currentLesson),
    0,
  );

  assert.equal(
    scoreLinkedVideoUrl(
      "https://www.youtube-nocookie.com/embed/9yB7DYq1PNs",
      currentLesson,
    ),
    0,
  );
});

test("should identify same-origin supplementary linked post or event URLs while excluding sibling lessons in the same course", () => {
  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://training.example.com.br/c/community-events/session-1",
      currentLesson,
    ),
    true,
  );

  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://training.example.com.br/c/other-course/sections/1/lessons/5",
      currentLesson,
    ),
    true,
  );

  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://training.example.com.br/c/course/sections/2/lessons/99",
      currentLesson,
    ),
    false,
  );

  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://training.example.com.br/courses/enterprise?conteudo=2",
      "https://training.example.com.br/courses/enterprise?conteudo=1",
    ),
    false,
  );

  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://training.example.com.br/courses/other-course?conteudo=1",
      "https://training.example.com.br/courses/enterprise?conteudo=1",
    ),
    true,
  );

  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://other.example/c/eventos/live-1",
      currentLesson,
    ),
    false,
  );

  assert.equal(
    isSupplementaryLinkedPostUrl(
      "https://training.example.com.br/about",
      currentLesson,
    ),
    false,
  );
});
