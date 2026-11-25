import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: true,
  outputDir: "test-results",
  reporter: "list",
  testDir: "tests/e2e",
  timeout: 45000,
  use: { trace: "retain-on-failure" },
  workers: 6,
});
