import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "**/__fixtures__/**", "**/__mocks__/**"],
      reporter: ["text"],
      thresholds: { lines: 100, branches: 96, functions: 97 },
    },
  },
});
