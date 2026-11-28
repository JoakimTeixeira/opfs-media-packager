import { expect, test } from "vitest";
import { harness } from "../tests/integration/track/__mocks__/headless-track-scan-setup.ts";

test("should reject privileged requests from a different extension", async () => {
  harness.reset();

  const response = await harness.sendRuntimeMessage(
    { type: "take-download-request", downloadRequestId: "request-1" },
    { id: "untrusted-extension", url: "https://training.example/" },
  );

  expect(response).toEqual({ error: "Untrusted extension message." });
});
