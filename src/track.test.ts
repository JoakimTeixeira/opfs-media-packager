// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { loadPage } from "./__mocks__/page.ts";

afterEach(() => vi.unstubAllGlobals());

test("should explain when the track page has no scan identifier", async () => {
  loadPage("track.html");
  const sendMessage = vi.fn(async () => ({}));

  vi.stubGlobal("chrome", {
    runtime: { sendMessage },
    storage: {
      local: {
        get: vi.fn(async (defaults: unknown) => defaults),
        set: vi.fn(),
      },
    },
  });

  await import("./track.ts");

  expect(document.querySelector("#summary")?.textContent).toBe(
    "The track scan was not found.",
  );

  expect(sendMessage).not.toHaveBeenCalled();
});
