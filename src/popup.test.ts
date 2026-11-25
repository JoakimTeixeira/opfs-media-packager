// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { loadPage } from "./__mocks__/page.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("should show an empty state for a tab with no detected streams", async () => {
  vi.useFakeTimers();
  loadPage("popup.html");
  const sendMessage = vi.fn(async () => ({ streams: [] }));

  vi.stubGlobal("chrome", {
    tabs: {
      query: vi.fn(async () => [
        { id: 42, url: "https://training.example/lesson" },
      ]),
      sendMessage: vi.fn(async () => ({})),
    },
    runtime: { sendMessage },
    storage: {
      local: {
        get: vi.fn(async (defaults: unknown) => defaults),
        set: vi.fn(),
      },
    },
  });

  await import("./popup.ts");

  expect(document.querySelector("#site")?.textContent).toBe("training.example");

  expect(document.querySelector("#list")?.textContent).toContain(
    "No HLS manifest detected",
  );

  expect(sendMessage).toHaveBeenCalledWith({
    type: "list-detections",
    tabId: 42,
  });
});
