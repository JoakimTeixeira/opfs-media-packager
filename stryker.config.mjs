/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  // Mutation tests verify URL, message-boundary, authorization, media-request,
  // and route-adapter guards; zero survivors are allowed.
  mutate: [
    "lib/security.ts",
    "lib/extension-messages.ts",
    "lib/media-authorization.ts",
    "lib/media-request.ts",
    "lib/download-control-state.ts",
    "lib/playlist-adapters.ts",
    "lib/playlist-queue-policy.ts",
  ],
  testRunner: "tap",
  tap: {
    testFiles: [
      "lib/security.test.ts",
      "lib/extension-messages.test.ts",
      "lib/extension-messages-subtitles.test.ts",
      "lib/media-authorization.test.ts",
      "lib/media-request.test.ts",
      "lib/download-control-state.test.ts",
      "lib/playlist-adapters.test.ts",
      "lib/playlist-queue-policy.test.ts",
    ],
  },
  reporters: ["clear-text", "html", "json"],
  coverageAnalysis: "perTest",
  concurrency: 8,
  logLevel: "warn",
  timeoutMS: 20000,
  thresholds: { high: 100, low: 100, break: 100 },
  tempDirName: ".stryker-tmp",
};
