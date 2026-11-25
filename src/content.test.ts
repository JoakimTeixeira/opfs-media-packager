// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("should report no direct video when the page has no video element", async () => {
  vi.useFakeTimers();
  document.body.innerHTML = "<main>No video here</main>";

  const state: {
    listener?: (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void,
    ) => unknown;
  } = {};

  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (listener: typeof state.listener) => {
          state.listener = listener;
        },
      },
      sendMessage: vi.fn(async () => ({})),
    },
  });

  await import("./content.ts");
  const respond = vi.fn();

  expect(state.listener).toBeDefined();
  state.listener?.({ type: "collect-direct-video" }, {}, respond);

  expect(respond).toHaveBeenCalledWith({ url: "" });
});
