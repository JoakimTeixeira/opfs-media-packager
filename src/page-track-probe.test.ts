// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

test("should install the page probe only once when the script is reinjected", async () => {
  const probeWindow = window as Window & {
    __opfsMediaPackagerProbeLoaded?: boolean;
  };

  delete probeWindow.__opfsMediaPackagerProbeLoaded;
  await import("./page-track-probe.ts");
  const wrappedFetch = window.fetch;

  expect(probeWindow.__opfsMediaPackagerProbeLoaded).toBe(true);
  vi.resetModules();
  await import("./page-track-probe.ts");

  expect(window.fetch).toBe(wrappedFetch);
});
