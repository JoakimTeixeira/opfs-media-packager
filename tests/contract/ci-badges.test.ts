import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const generatorPath = path.resolve("scripts/create-ci-badges.ts");

function runBadgeGenerator(reports: {
  harness: Record<string, unknown>;
  tests: Record<string, unknown>;
  coverage: Record<string, unknown>;
}) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ci-badges-"));

  const reportPaths = ["harness.json", "tests.json", "coverage.json"].map(
    (fileName) => path.join(temporaryDirectory, fileName),
  );

  const outputDirectory = path.join(temporaryDirectory, "badges");

  [reports.harness, reports.tests, reports.coverage].forEach(
    (report, index) => {
      writeFileSync(reportPaths[index], JSON.stringify(report));
    },
  );

  const result = spawnSync(
    process.execPath,
    [generatorPath, ...reportPaths, outputDirectory],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw new Error(result.stderr);
  }

  const readBadge = (fileName: string) =>
    JSON.parse(
      readFileSync(path.join(outputDirectory, fileName), "utf8"),
    ) as Record<string, unknown>;

  return { temporaryDirectory, readBadge };
}

describe("CI badge data", () => {
  it("should publish measured harness, test, and coverage results", () => {
    const result = runBadgeGenerator({
      harness: {
        level: { index: 4 },
        score: { earned: 105, max: 105 },
      },
      tests: {
        numTotalTests: 238,
        numPassedTests: 238,
        numFailedTests: 0,
      },
      coverage: {
        total: {
          lines: { pct: 100 },
          branches: { pct: 97.38 },
        },
      },
    });

    try {
      expect(result.readBadge("harness.json")).toMatchObject({
        label: "harness",
        message: "L4 105/105",
        color: "brightgreen",
      });

      expect(result.readBadge("tests.json")).toMatchObject({
        label: "tests",
        message: "238/238 passing",
        color: "brightgreen",
      });

      expect(result.readBadge("line-coverage.json")).toMatchObject({
        label: "line coverage",
        message: "100%",
        color: "brightgreen",
      });

      expect(result.readBadge("branch-coverage.json")).toMatchObject({
        label: "branch coverage",
        message: "97.38%",
        color: "brightgreen",
      });
    } finally {
      rmSync(result.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("should mark test failures red", () => {
    const result = runBadgeGenerator({
      harness: {
        level: { index: 4 },
        score: { earned: 105, max: 105 },
      },
      tests: {
        numTotalTests: 238,
        numPassedTests: 237,
        numFailedTests: 1,
      },
      coverage: {
        total: {
          lines: { pct: 100 },
          branches: { pct: 97.38 },
        },
      },
    });

    try {
      expect(result.readBadge("tests.json")).toMatchObject({
        message: "237/238 passing",
        color: "red",
      });
    } finally {
      rmSync(result.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("should report coverage below the required thresholds", () => {
    const result = runBadgeGenerator({
      harness: { level: { index: 3 }, score: { earned: 90, max: 105 } },
      tests: { numTotalTests: 5, numPassedTests: 5, numFailedTests: 0 },
      coverage: { total: { lines: { pct: 99 }, branches: { pct: 95 } } },
    });

    try {
      expect(result.readBadge("harness.json")).toMatchObject({
        message: "L3 90/105",
        color: "yellowgreen",
      });

      expect(result.readBadge("line-coverage.json").color).toBe("red");
      expect(result.readBadge("branch-coverage.json").color).toBe("red");
    } finally {
      rmSync(result.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("should reject missing and invalid report metrics", () => {
    const harness = { level: { index: 4 }, score: { earned: 105, max: 105 } };
    const tests = { numTotalTests: 5, numPassedTests: 5, numFailedTests: 0 };

    expect(() =>
      runBadgeGenerator({
        harness,
        tests,
        coverage: { total: { lines: { pct: null }, branches: { pct: 97 } } },
      }),
    ).toThrow("missing a required numeric metric");

    expect(() =>
      runBadgeGenerator({
        harness,
        tests,
        coverage: { total: { lines: { pct: 101 }, branches: { pct: 97 } } },
      }),
    ).toThrow("invalid metric values");
  });
});
