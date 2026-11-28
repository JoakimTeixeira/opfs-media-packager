import { test, assert } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative as relativePath } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../..", import.meta.url);
const rootPath = fileURLToPath(root);

async function listTextFiles(
  directory: string,
  skipDirs: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const full = join(directory, entry.name);
    const relativeFilePath = relativePath(rootPath, full);

    if (skipDirs.has(entry.name) || skipDirs.has(relativeFilePath)) continue;

    if (entry.isDirectory()) {
      results.push(...(await listTextFiles(full, skipDirs)));
      continue;
    }

    if (
      [".js", ".mjs", ".ts", ".mts", ".html", ".css", ".json", ".md"].includes(
        extname(entry.name),
      )
    ) {
      results.push(full);
    }
  }

  return results;
}

test("should keep page-originated data behind a validated message and URL boundary", async () => {
  const background = await readFile(new URL("src/background.ts", root), "utf8");

  const mediaRequest = await readFile(
    new URL("lib/media/media-request.ts", root),
    "utf8",
  );

  const content = await readFile(new URL("src/content.ts", root), "utf8");
  const app = await readFile(new URL("src/app.ts", root), "utf8");
  const popup = await readFile(new URL("src/popup.ts", root), "utf8");
  const course = await readFile(new URL("src/track.ts", root), "utf8");

  const pageCourseProbe = await readFile(
    new URL("src/page-track-probe.ts", root),
    "utf8",
  );

  assert.match(background, /isTrustedExtensionSender/);
  assert.match(background, /isTrustedTrackSender/);
  assert.match(background, /isTrustedTrackFrameSender/);
  assert.match(background, /fetchFromTrackPage/);
  assert.match(background, /fetch-source-media/);
  assert.match(background, /page-media-result/);
  assert.match(background, /validatedDownloadRequest/);
  assert.match(mediaRequest, /redirect: "error"/);
  assert.match(content, /event\.origin !== location\.origin/);
  assert.match(content, /fetch-media-from-page/);
  assert.match(content, /fetch-media-result/);
  assert.match(app, /fetchFromSourcePage/);
  assert.match(pageCourseProbe, /credentials: "omit"/);
  assert.match(pageCourseProbe, /referrer: location\.href/);
  assert.match(pageCourseProbe, /referrerPolicy: "unsafe-url"/);
  assert.match(app, /safeMediaUrl\(segment\.uri\)/);

  const downloadDisplay = await readFile(
    new URL("src/download-display.ts", root),
    "utf8",
  );

  assert.match(downloadDisplay, /function userError/);
  assert.notMatch(app, /setStatus\("Download failed", error\.message\)/);

  assert.match(
    app,
    /\[401, 403, 404, 429, 503\]\.includes\(response\.status\)/,
  );

  assert.match(app, /function classifyTrackTopicFailure/);

  assert.match(
    app,
    /shouldHaltTrackQueue[\s\S]*from "\.\.\/lib\/track\/track-queue-policy\.ts"/,
  );

  const queuePolicy = await readFile(
    new URL("lib/track/track-queue-policy.ts", root),
    "utf8",
  );

  assert.match(queuePolicy, /export function shouldHaltTrackQueue/);
  assert.match(app, /async function runSingleTrackTopic/);
  assert.notMatch(popup, /if \(result\?\.error\)/);
  assert.match(popup, /if \(!result\?\.ok\)/);
  assert.match(popup, /window\.addEventListener\("error"/);
  assert.match(popup, /window\.addEventListener\("unhandledrejection"/);
  assert.notMatch(course, /if \(result\?\.error\)/);
  assert.match(course, /if \(!result\?\.ok\)/);
  assert.match(course, /window\.addEventListener\("error"/);
  assert.match(course, /window\.addEventListener\("unhandledrejection"/);

  assert.match(
    pageCourseProbe,
    /if \(fetched\.rateLimited\) return RATE_LIMITED_PROBE_RESULT/,
  );

  assert.match(
    pageCourseProbe,
    /if \(linked\.rateLimited\) return RATE_LIMITED_PROBE_RESULT/,
  );

  assert.strictEqual(
    pageCourseProbe.match(/rateLimited:\s*outcome\.rateLimited/g)?.length,
    3,
  );

  assert.match(pageCourseProbe, /rateLimited:\s*batchState\.rateLimited/);
  assert.match(pageCourseProbe, /media_transcript_id/);
  assert.match(pageCourseProbe, /extractTopicCompanionDocumentsFromRichText/);
  assert.match(course, /DEFAULT_TRACK_DOWNLOAD_MODE/);
  assert.match(course, /trackDownloadMode/);

  const diagramFnStart = background.indexOf(
    "async function exportExcalidrawSvg",
  );

  const diagramFnEnd = background.indexOf(
    "async function runHeadlessSlidesCapture",
  );

  const slidesFnStart = background.indexOf("async function exportSlidesToPdf");

  const slidesFnEnd = background.indexOf("function handleAsyncExport");

  assert.notStrictEqual(diagramFnStart, -1);
  assert.notStrictEqual(diagramFnEnd, -1);
  assert.notStrictEqual(slidesFnStart, -1);
  assert.notStrictEqual(slidesFnEnd, -1);

  const diagramFnBody = background.slice(diagramFnStart, diagramFnEnd);
  const slidesFnBody = background.slice(slidesFnStart, slidesFnEnd);

  assert.notMatch(
    diagramFnBody,
    /openMinimizedWorkerTab|chrome\.windows\.create/,
  );

  assert.notMatch(
    slidesFnBody,
    /openMinimizedWorkerTab|chrome\.windows\.create|captureVisibleTab/,
  );

  assert.match(background, /"diagram-frame-ready"/);
  assert.match(content, /"diagram-frame-ready"/);
  assert.match(background, /"slides-frame-ready"/);
  assert.match(content, /"slides-frame-ready"/);
  assert.match(app, /canonicalDocumentUrlKey/);
  assert.match(app, /annotateMarkdownWithDownloadedArtifacts/);
});

const ALLOWED_PUBLIC_INTEGRATION_HOSTS = new Set([
  "developer.chrome.com",
  "nodejs.org",
  "www.w3.org",
  "unpkg.com",
  "github.com",
  "gist.github.com",
  "img.shields.io",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  "excalidraw.com",
  "app.excalidraw.com",
  "link.excalidraw.com",
  "e2e.excalidraw.com",
  "notexcalidraw.com",
  "json.schemastore.org",
]);

const ALLOWED_SYNTHETIC_HOST_EXACT = new Set([
  "localhost",
  "example",
  "example.com",
  "example.test",
  "host.local",
  "x",
]);

const ALLOWED_SYNTHETIC_HOST_SUFFIXES = [
  ".example",
  ".example.com",
  ".example.net",
  ".example.org",
  ".example.test",
  ".example.com.br",
  ".test",
  ".local",
];

function isAllowedRepoHostname(hostname: string): boolean {
  if (
    ALLOWED_PUBLIC_INTEGRATION_HOSTS.has(hostname) ||
    ALLOWED_SYNTHETIC_HOST_EXACT.has(hostname)
  ) {
    return true;
  }

  if (
    ALLOWED_SYNTHETIC_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return true;
  }

  return /^(?:127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)$/.test(
    hostname,
  );
}

test("should use only anonymized example domains and documented public integrations", async () => {
  const files = await listTextFiles(
    rootPath,
    new Set([
      "node_modules",
      "vendor",
      "dist",
      "test-results",
      ".stryker-tmp",
      "coverage",
      "reports",
      join(".agents", "skills"),
      join(".github", "skills"),
    ]),
  );

  for (const file of files) {
    if (file.endsWith("package-lock.json")) continue;
    const text = await readFile(file, "utf8");

    for (const match of text.matchAll(
      /https?:\/\/(?:[^\s"'`<>/@${}]+@)?([^/\s"'`),;<>\\${}:[\]?#]+)/g,
    )) {
      const host = (match[1] ?? "")
        .replace(/\*\.?/g, "")
        .replace(/\.+$/, "")
        .toLowerCase();

      if (!host) continue;

      assert.ok(
        isAllowedRepoHostname(host),
        `Unexpected non-anonymized hostname "${host}" in ${file}`,
      );
    }
  }
});

test("should prevent else-branch and nested-ternary cognitive complexity regressions in core scripts", async () => {
  const coreFiles = [
    "src/background.ts",
    "src/content.ts",
    "src/track.ts",
    "src/page-track-probe.ts",
    "lib/subtitles/subtitle-language.ts",
    "lib/security/extension-messages.ts",
  ];

  for (const relative of coreFiles) {
    const text = await readFile(new URL(relative, root), "utf8");
    const lines = text.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

      assert.notMatch(
        line,
        /\belse\b/,
        `Unexpected else branch at ${relative}:${index + 1}`,
      );

      const stripped = line
        .replace(/\?\./g, "")
        .replace(/\?\?/g, "")
        .replace(/\/(?:\\.|[^/\\\n])+\/[gimsuy]*/g, "")
        .replace(/"(?:\\.|[^"\\\n])*"/g, "")
        .replace(/'(?:\\.|[^'\\\n])*'/g, "");

      assert.notMatch(
        stripped,
        /^\s*:\s+.*\?/,
        `Nested ternary continuation at ${relative}:${index + 1}`,
      );
    }
  }
});

test("should keep documentation files within line-length budgets", async () => {
  const files = await listTextFiles(
    rootPath,
    new Set([
      "node_modules",
      "vendor",
      "dist",
      "test-results",
      ".stryker-tmp",
      join(".agents", "skills"),
      join(".github", "skills"),
    ]),
  );

  const markdownFiles = files.filter((file) => extname(file) === ".md");
  const readmePath = join(rootPath, "README.md");

  assert.ok(markdownFiles.includes(readmePath), "README.md must exist");

  for (const file of markdownFiles) {
    const text = await readFile(file, "utf8");
    const lineCount = text.trimEnd().split(/\r?\n/).length;
    const maxLines = file === readmePath ? 100 : 200;

    assert.ok(
      lineCount <= maxLines,
      `${file} has ${lineCount} lines (max ${maxLines})`,
    );
  }
});
