import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const hookScript = path.resolve("scripts/copilot-hooks.mjs");
const fixturePath = path.resolve("tests/contract/copilot-hook-fixture.md");

function runHook(event: unknown): Record<string, unknown> {
  const result = spawnSync(process.execPath, [hookScript], {
    encoding: "utf8",
    input: JSON.stringify(event),
  });

  if (result.status !== 0) throw new Error(result.stderr);

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("Copilot hook policy", () => {
  it.each([
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git checkout -- src/app.ts",
    "git restore README.md",
    "rm -rf ./generated",
    "Remove-Item ./generated -Recurse -Force",
    "rd /s /q generated",
    "del /s /q generated",
  ])("should deny destructive command: %s", (command) => {
    expect(
      runHook({
        hook_event_name: "preToolUse",
        tool_name: "bash",
        tool_input: { command },
      }).permissionDecision,
    ).toBe("deny");
  });

  it.each(["git status --short", "npm test", "git add README.md"])(
    "should allow routine command: %s",
    (command) => {
      expect(
        runHook({
          hook_event_name: "preToolUse",
          tool_name: "bash",
          tool_input: { command },
        }),
      ).toEqual({});
    },
  );

  it("should deny malformed hook input", () => {
    const result = spawnSync(process.execPath, [hookScript], {
      encoding: "utf8",
      input: "{",
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      permissionDecision: "deny",
    });
  });

  it("should leave unrelated tools unchanged", () => {
    expect(
      runHook({
        hook_event_name: "preToolUse",
        tool_name: "edit",
        tool_input: { filePath: "README.md" },
      }),
    ).toEqual({});
  });

  it("should format an edited file inside the workspace", () => {
    fs.writeFileSync(fixturePath, "#   Hook test\n");

    try {
      expect(
        runHook({
          hook_event_name: "postToolUse",
          tool_name: "edit",
          cwd: process.cwd(),
          tool_input: { filePath: path.relative(process.cwd(), fixturePath) },
        }),
      ).toEqual({});

      expect(fs.readFileSync(fixturePath, "utf8")).toBe("# Hook test\n");
    } finally {
      fs.rmSync(fixturePath, { force: true });
    }
  });

  it("should not format paths outside the workspace", () => {
    expect(
      runHook({
        hook_event_name: "postToolUse",
        tool_name: "edit",
        cwd: process.cwd(),
        tool_input: { filePath: "../outside/README.md" },
      }),
    ).toEqual({});
  });
});
