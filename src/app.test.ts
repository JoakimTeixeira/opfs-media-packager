// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { loadPage } from "./__mocks__/page.ts";

afterEach(() => vi.unstubAllGlobals());

test("should restore the saved downloads subfolder on the download page", async () => {
  loadPage("index.html");

  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "2.49.0" }) },
    storage: {
      local: {
        get: vi.fn(async (defaults: object) => ({
          ...defaults,
          downloadSubfolder: "Lessons",
        })),
        set: vi.fn(),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn() },
    },
  });

  await import("./app.ts");

  await vi.waitFor(() =>
    expect(
      document.querySelector("#download-subfolder-status")?.textContent,
    ).toBe("Downloads / Lessons"),
  );

  expect(
    (document.querySelector("#download-subfolder") as HTMLInputElement).value,
  ).toBe("Lessons");
});
