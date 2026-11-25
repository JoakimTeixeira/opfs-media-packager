/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  // Mutation tests verify URL, message-boundary, authorization, media-request,
  // and route-adapter guards; zero survivors are allowed.
  mutate: [
    "lib/security/security.ts",
    "lib/security/extension-messages.ts",
    "lib/security/page-subtitles.ts",
    "lib/media/media-authorization.ts",
    "lib/media/media-request.ts",
    "lib/downloads/download-control-state.ts",
    "lib/playlist/playlist-adapters.ts",
    "lib/playlist/playlist-queue-policy.ts",
  ],
  testRunner: "vitest",
  reporters: ["clear-text", "html", "json"],
  coverageAnalysis: "perTest",
  concurrency: 8,
  logLevel: "warn",
  timeoutMS: 20000,
  thresholds: { high: 100, low: 100, break: 100 },
  tempDirName: ".stryker-tmp",
};
