import test from "node:test";
import assert from "node:assert/strict";
import { knownSubtitleTracksFromPage } from "./extension-messages.ts";

test("should bound and remove unsafe page-provided subtitle candidates", () => {
  const manyTracks = Array.from({ length: 21 }, (_, index) => ({
    url: `https://cdn.example/${index}.vtt`,
    language: `Language ${index}`,
  }));

  assert.equal(knownSubtitleTracksFromPage(manyTracks).length, 20);

  assert.deepEqual(
    knownSubtitleTracksFromPage([
      {
        url: "https://cdn.example/caption.vtt",
        language: " Portuguese ",
        label: "PT",
      },
      { url: "file:///secret.vtt", language: "English" },
      { url: "https://cdn.example/no-language.vtt", language: "" },
      undefined,
      null,
    ]),
    [
      {
        url: "https://cdn.example/caption.vtt",
        language: "Portuguese",
        label: "PT",
      },
    ],
  );

  assert.deepEqual(knownSubtitleTracksFromPage("not an array"), []);
});
