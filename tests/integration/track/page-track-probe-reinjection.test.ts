import { test, assert } from "vitest";
import { compiledProbeScript } from "./__mocks__/page-track-probe-environment.ts";
import { createProbeSandbox } from "./__mocks__/page-track-probe-sandbox.ts";

test("remains idempotent when re-executed via chrome.scripting.executeScript", () => {
  const sandbox = createProbeSandbox({
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });

  assert.strictEqual(sandbox.windowObj.__opfsMediaPackagerProbeLoaded, true);

  // Executing the script a second time should be a safe no-op.
  assert.doesNotThrow(() => {
    compiledProbeScript.runInContext(sandbox.context);
  });
});
