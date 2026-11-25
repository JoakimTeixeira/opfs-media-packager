import { expect, test } from "vitest";
import { harness } from "../tests/integration/playlist/__mocks__/headless-playlist-scan-setup.ts";

test("should reject privileged requests from a different extension", async () => {
  harness.reset();

  const response = await harness.sendRuntimeMessage(
    { type: "take-download-request", downloadRequestId: "request-1" },
    { id: "untrusted-extension", url: "https://training.example/" },
  );

  expect(response).toEqual({ error: "Untrusted extension message." });
});
