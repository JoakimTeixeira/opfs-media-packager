import { expect, test } from "vitest";
import { createDocumentCollector } from "./item-asset-collector.ts";

test("should retain one copy of images and their aliases", () => {
  const collector = createDocumentCollector();

  collector.addImage(
    { kind: "image", url: "https://assets.example/a.png", filename: "a.png" },
    ["https://assets.example/alias.png"],
  );

  collector.addImage({
    kind: "image",
    url: "https://assets.example/alias.png",
    filename: "duplicate.png",
  });

  expect(collector.build("Notes").images).toEqual([
    { kind: "image", url: "https://assets.example/a.png", filename: "a.png" },
  ]);
});

test("should classify and deduplicate PDF, diagram, and slide links", () => {
  const collector = createDocumentCollector();
  const page = "https://training.example/lesson";

  collector.addLink("/guide.pdf", "Guide", page);
  collector.addLink("/guide.pdf", "Duplicate", page);
  collector.addLink("https://app.excalidraw.com/s/123", "", page);
  collector.addLink("https://slides.example/?slide=1", "", page);
  collector.addLink("javascript:alert(1)", "Unsafe", page);
  const result = collector.build("Notes");

  expect(result.pdfs).toHaveLength(1);
  expect(result.pdfs[0].url).toBe("https://training.example/guide.pdf");
  expect(result.diagrams[0].title).toBe("Excalidraw diagram");
  expect(result.slides[0].title).toBe("Slides");
});
