import test from "node:test";
import assert from "node:assert/strict";
import {
  itemNumberPrefix,
  prefixedDocumentFilename,
} from "../lib/item-assets.ts";

test("should extract lesson number prefix and format Windows-safe prefixed material filenames", () => {
  assert.equal(
    itemNumberPrefix("2.4 Transformando contexto em Feature"),
    "2.4 ",
  );

  assert.equal(itemNumberPrefix("1.1 Intro"), "1.1 ");
  assert.equal(itemNumberPrefix("  10.2.3 Deep"), "10.2.3 ");
  assert.equal(itemNumberPrefix("Introduction"), "");
  assert.equal(itemNumberPrefix("2.4"), "");

  assert.equal(
    prefixedDocumentFilename(
      "2.4 Transformando contexto em Feature",
      "Diagramas mostrados na aula",
      "svg",
    ),
    "2.4 Diagramas mostrados na aula.svg",
  );

  assert.equal(
    prefixedDocumentFilename(
      "2.4 Transformando contexto em Feature",
      "2.4 Transformando contexto em Feature",
      "md",
    ),
    "2.4 Transformando contexto em Feature.md",
  );

  assert.equal(
    prefixedDocumentFilename("1.1 Intro", "handout.PDF", ".pdf"),
    "1.1 handout.pdf",
  );

  assert.equal(
    prefixedDocumentFilename("1.1 Intro", "🔴|:", "png", "diagram"),
    "1.1 diagram.png",
  );

  assert.equal(
    prefixedDocumentFilename("1.1 Intro", "video.mp4", "mp4", "fallback"),
    "1.1 video.mp4",
  );

  assert.equal(prefixedDocumentFilename("No Number", "", ""), "document.bin");

  const bounded = prefixedDocumentFilename("2.4 Item", "a".repeat(140), "png");

  assert.equal(bounded.endsWith(".png"), true);
  assert.equal(bounded.length <= 120, true);

  assert.equal(
    prefixedDocumentFilename("2.4 Item", "🔴", "png", "..."),
    "2.4 document.png",
  );

  assert.equal(prefixedDocumentFilename("2.4 Item", "2.4 - ", "md"), "2.4.md");
});
