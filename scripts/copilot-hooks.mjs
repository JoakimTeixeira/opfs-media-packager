import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const destructiveCommands = [
  /\bgit\s+reset\b[^\r\n;&|]*\s--hard(?:\s|$)/i,
  /\bgit\s+clean\b[^\r\n;&|]*\s-[a-z]*f[a-z]*(?:\s|$)/i,
  /\bgit\s+checkout\s+--(?:\s|$)/i,
  /\bgit\s+restore\b/i,
  /\brm\s+-[a-z]*r[a-z]*f[a-z]*(?:\s|$)/i,
  /\brm\s+-[a-z]*f[a-z]*r[a-z]*(?:\s|$)/i,
  /\brm\b[^\r\n;&|]*(?:--recursive\b[^\r\n;&|]*--force\b|--force\b[^\r\n;&|]*--recursive\b)/i,
  /\b(?:Remove-Item|ri)\b[^\r\n;&|]*(?:-Recurse\b[^\r\n;&|]*-Force\b|-Force\b[^\r\n;&|]*-Recurse\b)/i,
  /\b(?:rmdir|rd)\s+\/s\s+\/q\b/i,
  /\bdel\s+\/s\s+\/q\b/i,
];

const filePathKeys = new Set([
  "filePath",
  "file_path",
  "path",
  "targetPath",
  "target_path",
]);

const formatExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const ignoredPathParts = new Set([
  ".git",
  "dist",
  "node_modules",
  "reports",
  "test-results",
  "vendor",
]);

function commandFromArgs(toolArgs) {
  if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    return "";
  }

  return [toolArgs.command, toolArgs.script, toolArgs.commandLine]
    .filter((value) => typeof value === "string")
    .join("\n");
}

function isDestructiveCommand(command) {
  return destructiveCommands.some((pattern) => pattern.test(command));
}

function pathValues(value) {
  if (Array.isArray(value)) return value.flatMap(pathValues);
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, child]) => [
    ...(filePathKeys.has(key) && typeof child === "string" ? [child] : []),
    ...pathValues(child),
  ]);
}

function workspaceFile(filePath, root) {
  if (!formatExtensions.has(path.extname(filePath).toLowerCase())) return null;

  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(path.resolve(root, filePath));
    const relativePath = path.relative(realRoot, realFile);
    const pathParts = relativePath.split(path.sep);

    const skillDirectories = [
      path.join(".agents", "skills"),
      path.join(".github", "skills"),
    ];

    const isSkillAsset = skillDirectories.some((directory) =>
      relativePath.startsWith(`${directory}${path.sep}`),
    );

    const isInsideRoot =
      relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath);

    if (
      !isInsideRoot ||
      isSkillAsset ||
      pathParts.some((part) => ignoredPathParts.has(part))
    ) {
      return null;
    }

    return fs.statSync(realFile).isFile() ? realFile : null;
  } catch {
    return null;
  }
}

function changedFilesFromArgs(toolArgs, root) {
  return [
    ...new Set(
      pathValues(toolArgs)
        .map((filePath) => workspaceFile(filePath, root))
        .filter((filePath) => filePath !== null),
    ),
  ].slice(0, 20);
}

function formatFiles(files, root) {
  const prettierCli = path.join(
    root,
    "node_modules",
    "prettier",
    "bin",
    "prettier.cjs",
  );

  if (!fs.existsSync(prettierCli)) return files;

  return files.filter((file) => {
    try {
      execFileSync(process.execPath, [prettierCli, "--write", file], {
        cwd: root,
        stdio: "ignore",
      });

      return false;
    } catch {
      return true;
    }
  });
}

function handleEvent(event, format = formatFiles) {
  if (!event || typeof event !== "object") return {};

  const eventName = event.hook_event_name || event.hookEventName || "";
  const toolName = event.tool_name || event.toolName || "";
  const toolArgs = event.tool_input || event.toolArgs || {};

  if (eventName === "preToolUse" || eventName === "PreToolUse") {
    const shellTool = /^(bash|powershell|Bash)$/i.test(toolName);
    const command = commandFromArgs(toolArgs);

    if (!shellTool || !isDestructiveCommand(command)) return {};

    return {
      permissionDecision: "deny",
      permissionDecisionReason:
        "This command can discard repository or filesystem data. Run it manually after reviewing its exact targets.",
    };
  }

  const isEditEvent =
    eventName === "postToolUse" || eventName === "PostToolUse";

  const isWriteTool =
    /^(edit|create|apply_patch|str_replace_editor|write_file)$/i.test(toolName);

  if (!isEditEvent || !isWriteTool) return {};

  const root = path.resolve(
    typeof event.cwd === "string" ? event.cwd : process.cwd(),
  );

  const changedFiles = changedFilesFromArgs(toolArgs, root);

  if (changedFiles.length === 0) return {};

  const failedFiles = format(changedFiles, root);

  if (failedFiles.length === 0) return {};

  const paths = failedFiles.map((file) => path.relative(root, file)).join(", ");

  return {
    additionalContext: `Prettier could not format ${paths}. Run npm run format:check and resolve the reported issues.`,
  };
}

function readEvent() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function run() {
  const event = readEvent();

  const output =
    event === null
      ? {
          permissionDecision: "deny",
          permissionDecisionReason:
            "The hook input could not be validated. Review the tool call manually.",
        }
      : handleEvent(event);

  process.stdout.write(JSON.stringify(output));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  run();
}

export { changedFilesFromArgs, handleEvent, isDestructiveCommand };
