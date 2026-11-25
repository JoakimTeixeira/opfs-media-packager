import { expect, test, vi } from "vitest";
import {
  errorMessageOf,
  formatBytes,
  isAbortError,
  userError,
} from "./download-display.ts";

test("should identify cancellation and format download sizes", () => {
  expect(isAbortError(new DOMException("Cancelled", "AbortError"))).toBe(true);
  expect(isAbortError(new Error("Network"))).toBe(false);
  expect(errorMessageOf(new Error("Network"))).toBe("Network");
  expect(formatBytes(1536)).toBe("1.5 KB");
});

test("should explain host access failures without exposing technical details", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  expect(userError(new Error("HTTP 403"))).toContain(
    "Keep the source page open",
  );

  expect(userError(new Error("unknown"))).toContain(
    "refreshing the video page",
  );

  log.mockRestore();
});
