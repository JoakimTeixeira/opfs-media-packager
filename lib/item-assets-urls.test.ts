import test from "node:test";
import assert from "node:assert/strict";
import {
  isSlidesDeckUrl,
  isExcalidrawUrl,
  canonicalDocumentUrlKey,
  activeStorageBlobUrl,
} from "./item-assets.ts";

test("should detect interactive slide deck URLs while filtering repos, videos, courses, and static files", () => {
  assert.equal(
    isSlidesDeckUrl("https://slides.example/architecture?slide=9"),
    true,
  );

  assert.equal(isSlidesDeckUrl("https://slides.example/?slide=0"), true);

  assert.equal(
    isSlidesDeckUrl("https://slides.example/", "Slides da aula"),
    true,
  );

  assert.equal(
    isSlidesDeckUrl("https://slides.example/deck.html", "Apresentação"),
    true,
  );

  assert.equal(
    isSlidesDeckUrl("https://slides.example/module/slides/1", "Main Deck"),
    true,
  );

  assert.equal(
    isSlidesDeckUrl("https://slides.example/blog/article", "Slides notes"),
    false,
  );

  assert.equal(isSlidesDeckUrl("https://slides.example/?slide=intro"), false);

  assert.equal(
    isSlidesDeckUrl("http://slides.example/?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://app.excalidraw.com/?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://cdn.example/deck.pdf?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://cdn.example/slide.png?slide=1", "Slides"),
    false,
  );

  assert.equal(
    isSlidesDeckUrl(
      "https://training.example/c/eng/sections/s1/lessons/l1?slide=1",
      "Slides",
    ),
    false,
  );

  assert.equal(
    isSlidesDeckUrl("https://training.example/courses/abc?slide=1", "Slides"),
    false,
  );

  for (const excludedHost of [
    "github.com",
    "gist.github.com",
    "youtube.com",
    "youtu.be",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "amazon.com",
    "npmjs.com",
  ]) {
    assert.equal(
      isSlidesDeckUrl(`https://${excludedHost}/talk?slide=2`, "Slides"),
      false,
    );
  }

  assert.equal(isSlidesDeckUrl("not-a-url", "Slides"), false);
});

test("should identify valid Excalidraw URLs across allowed subdomains", () => {
  assert.equal(isExcalidrawUrl("https://app.excalidraw.com/s/123"), true);
  assert.equal(isExcalidrawUrl("https://app.excalidraw.com/l/abc"), true);
  assert.equal(isExcalidrawUrl("https://link.excalidraw.com/l/xyz"), true);
  assert.equal(isExcalidrawUrl("https://excalidraw.com/#json=1,key"), true);
  assert.equal(isExcalidrawUrl("http://excalidraw.com/#room=1"), true);

  assert.equal(isExcalidrawUrl("https://notexcalidraw.com/s/123"), false);

  assert.equal(
    isExcalidrawUrl("https://training.example/excalidraw.com"),
    false,
  );

  assert.equal(isExcalidrawUrl("javascript:excalidraw.com"), false);
  assert.equal(isExcalidrawUrl("http://127.0.0.1/excalidraw.com"), false);
});

test("should normalize canonical material URL keys across images, PDFs, diagrams, and slides", () => {
  assert.equal(
    canonicalDocumentUrlKey("  javascript:bad  ", "pdf"),
    "javascript:bad",
  );

  const imgRepr =
    "https://assets.example/rails/active_storage/representations/redirect/sig1/var2/arch.png#view";

  const imgBlob =
    "https://assets.example/rails/active_storage/blobs/redirect/sig1/arch.png/";

  assert.equal(
    canonicalDocumentUrlKey(imgRepr, "image"),
    canonicalDocumentUrlKey(imgBlob, "image"),
  );

  assert.equal(
    canonicalDocumentUrlKey("https://assets.example/", "pdf"),
    "https://assets.example/",
  );

  assert.equal(
    canonicalDocumentUrlKey(
      "https://SLIDES.example/deck/?slide=9#top",
      "slides",
    ),
    "https://slides.example/deck",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://slides.example/deck?slide=2", "slides"),
    "https://slides.example/deck",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://slides.example/?slide=intro#a", "slides"),
    "https://slides.example/?slide=intro",
  );

  assert.equal(
    canonicalDocumentUrlKey(
      "https://APP.EXCALIDRAW.COM/l/room/scene/#",
      "diagram",
    ),
    "https://app.excalidraw.com/l/room/scene",
  );

  assert.equal(
    canonicalDocumentUrlKey("https://excalidraw.com/#json=123,abc", "diagram"),
    "https://excalidraw.com/#json=123,abc",
  );
});

test("should rewrite ActiveStorage representation URLs to original blob URLs and reject others", () => {
  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/rails/active_storage/representations/redirect/signed123/var456/diagram.png",
    ),
    "https://assets.example/rails/active_storage/blobs/redirect/signed123/diagram.png",
  );

  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/app/rails/active_storage/representations/proxy/signed123/var456/photo.webp",
    ),
    "https://assets.example/app/rails/active_storage/blobs/proxy/signed123/photo.webp",
  );

  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/rails/active_storage/representations/signed123/var456/legacy.jpg",
    ),
    "https://assets.example/rails/active_storage/blobs/redirect/signed123/legacy.jpg",
  );

  assert.equal(
    activeStorageBlobUrl(
      "https://assets.example/rails/active_storage/blobs/proxy/signed123/photo.png",
    ),
    null,
  );

  assert.equal(
    activeStorageBlobUrl("https://cdn.example/images/photo.png"),
    null,
  );

  assert.equal(
    activeStorageBlobUrl(
      "http://localhost/rails/active_storage/representations/redirect/a/b/c.png",
    ),
    null,
  );
});
