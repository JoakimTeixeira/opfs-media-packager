import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);

async function listTextFiles(
  directory: string,
  skipDirs: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const full = join(directory, entry.name);

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
  const background = await readFile(new URL("background.ts", root), "utf8");

  const mediaRequest = await readFile(
    new URL("lib/media-request.ts", root),
    "utf8",
  );

  const content = await readFile(new URL("content.ts", root), "utf8");
  const app = await readFile(new URL("app.ts", root), "utf8");
  const popup = await readFile(new URL("popup.ts", root), "utf8");
  const course = await readFile(new URL("playlist.ts", root), "utf8");

  const pageCourseProbe = await readFile(
    new URL("page-playlist-probe.ts", root),
    "utf8",
  );

  assert.match(background, /isTrustedExtensionSender/);
  assert.match(background, /isTrustedPlaylistSender/);
  assert.match(background, /isTrustedPlaylistFrameSender/);
  assert.match(background, /fetchFromPlaylistPage/);
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
  assert.match(app, /function userError/);
  assert.doesNotMatch(app, /setStatus\("Download failed", error\.message\)/);

  assert.match(
    app,
    /\[401, 403, 404, 429, 503\]\.includes\(response\.status\)/,
  );

  assert.match(app, /function classifyPlaylistItemFailure/);

  assert.match(
    app,
    /shouldHaltPlaylistQueue[\s\S]*from "\.\/lib\/playlist-queue-policy\.ts"/,
  );

  const queuePolicy = await readFile(
    new URL("lib/playlist-queue-policy.ts", root),
    "utf8",
  );

  assert.match(queuePolicy, /export function shouldHaltPlaylistQueue/);
  assert.match(app, /async function runSinglePlaylistItem/);
  assert.doesNotMatch(popup, /if \(result\?\.error\)/);
  assert.match(popup, /if \(!result\?\.ok\)/);
  assert.match(popup, /window\.addEventListener\("error"/);
  assert.match(popup, /window\.addEventListener\("unhandledrejection"/);
  assert.doesNotMatch(course, /if \(result\?\.error\)/);
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

  assert.equal(
    pageCourseProbe.match(/rateLimited:\s*outcome\.rateLimited/g)?.length,
    3,
  );

  assert.match(pageCourseProbe, /rateLimited:\s*batchState\.rateLimited/);
  assert.match(pageCourseProbe, /media_transcript_id/);
  assert.match(pageCourseProbe, /extractItemCompanionDocumentsFromRichText/);
  assert.match(course, /DEFAULT_PLAYLIST_DOWNLOAD_MODE/);
  assert.match(course, /playlistDownloadMode/);

  const diagramFnStart = background.indexOf(
    "async function exportExcalidrawSvg",
  );

  const diagramFnEnd = background.indexOf(
    "async function runHeadlessSlidesCapture",
  );

  const slidesFnStart = background.indexOf("async function exportSlidesToPdf");

  const slidesFnEnd = background.indexOf("function handleAsyncExport");

  assert.notEqual(diagramFnStart, -1);
  assert.notEqual(diagramFnEnd, -1);
  assert.notEqual(slidesFnStart, -1);
  assert.notEqual(slidesFnEnd, -1);

  const diagramFnBody = background.slice(diagramFnStart, diagramFnEnd);
  const slidesFnBody = background.slice(slidesFnStart, slidesFnEnd);

  assert.doesNotMatch(
    diagramFnBody,
    /openMinimizedWorkerTab|chrome\.windows\.create/,
  );

  assert.doesNotMatch(
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
    "background.ts",
    "content.ts",
    "playlist.ts",
    "page-playlist-probe.ts",
    "lib/subtitle-language.ts",
    "lib/extension-messages.ts",
  ];

  for (const relative of coreFiles) {
    const text = await readFile(new URL(relative, root), "utf8");
    const lines = text.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

      assert.doesNotMatch(
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

      assert.doesNotMatch(
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
    new Set(["node_modules", "vendor", "dist", "test-results", ".stryker-tmp"]),
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
