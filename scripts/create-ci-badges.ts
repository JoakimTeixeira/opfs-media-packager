import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [harnessPath, testPath, coveragePath, outputPath] = process.argv.slice(2);

if (![harnessPath, testPath, coveragePath, outputPath].every(Boolean)) {
  throw new Error(
    "Usage: node scripts/create-ci-badges.ts <harness.json> <tests.json> <coverage-summary.json> <output-dir>",
  );
}

const [harnessReport, testReport, coverageReport] = await Promise.all(
  [harnessPath, testPath, coveragePath].map(async (reportPath) =>
    JSON.parse(await readFile(reportPath, "utf8")),
  ),
);

type HarnessReport = {
  level?: { index?: unknown };
  score?: { earned?: unknown; max?: unknown };
};

type TestReport = {
  numTotalTests?: unknown;
  numPassedTests?: unknown;
  numFailedTests?: unknown;
};

type CoverageReport = {
  total?: { lines?: { pct?: unknown }; branches?: { pct?: unknown } };
};

function numericMetric(metric: unknown): number {
  if (typeof metric !== "number" || !Number.isFinite(metric)) {
    throw new Error("CI reports are missing a required numeric metric.");
  }

  return metric;
}

const harness = harnessReport as HarnessReport;
const tests = testReport as TestReport;
const coverage = coverageReport as CoverageReport;
const level = numericMetric(harness.level?.index);
const earnedPoints = numericMetric(harness.score?.earned);
const maximumPoints = numericMetric(harness.score?.max);
const totalTests = numericMetric(tests.numTotalTests);
const passedTests = numericMetric(tests.numPassedTests);
const failedTests = numericMetric(tests.numFailedTests);
const lineCoverage = numericMetric(coverage.total?.lines?.pct);
const branchCoverage = numericMetric(coverage.total?.branches?.pct);

if (
  [
    level,
    earnedPoints,
    maximumPoints,
    totalTests,
    passedTests,
    failedTests,
  ].some((metric) => !Number.isInteger(metric) || metric < 0) ||
  earnedPoints > maximumPoints ||
  passedTests + failedTests > totalTests ||
  [lineCoverage, branchCoverage].some((metric) => metric < 0 || metric > 100)
) {
  throw new Error("CI reports contain invalid metric values.");
}

const levelNames = [
  "Unharnessed",
  "Documented",
  "Guided",
  "Sensing",
  "Self-correcting",
];

const levelColors = ["red", "orange", "yellow", "yellowgreen", "brightgreen"];
const levelName = levelNames[level];
const levelColor = levelColors[level];

if (!levelName || !levelColor || maximumPoints <= 0 || totalTests <= 0) {
  throw new Error(
    "CI reports contain an unsupported score level or empty totals.",
  );
}

const badge = (label: string, message: string, color: string) => ({
  schemaVersion: 1,
  label,
  message,
  color,
});

const badges = {
  "harness.json": badge(
    "harness",
    `L${level} ${earnedPoints}/${maximumPoints}`,
    levelColor,
  ),
  "tests.json": badge(
    "tests",
    `${passedTests}/${totalTests} passing`,
    failedTests === 0 && passedTests === totalTests ? "brightgreen" : "red",
  ),
  "line-coverage.json": badge(
    "line coverage",
    `${lineCoverage}%`,
    lineCoverage >= 100 ? "brightgreen" : "red",
  ),
  "branch-coverage.json": badge(
    "branch coverage",
    `${branchCoverage}%`,
    branchCoverage >= 96 ? "brightgreen" : "red",
  ),
};

await mkdir(outputPath, { recursive: true });

await Promise.all(
  Object.entries(badges).map(([fileName, data]) =>
    writeFile(path.join(outputPath, fileName), `${JSON.stringify(data)}\n`),
  ),
);
