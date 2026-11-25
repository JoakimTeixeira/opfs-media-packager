import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestContentScript {
  readonly matches: readonly string[];
  readonly js: readonly string[];
  readonly all_frames?: boolean;
  readonly world?: string;
}

interface ExtensionManifest {
  readonly permissions: readonly string[];
  readonly background: { readonly service_worker: string };
  readonly content_scripts: readonly ManifestContentScript[];
  readonly web_accessible_resources?: readonly unknown[];
}

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

test("should schedule downloads without a per-download picker", async () => {
  const source = await readFile(new URL("app.ts", root), "utf8");
  const background = await readFile(new URL("background.ts", root), "utf8");

  assert.match(source, /chrome\.downloads\.download/);
  assert.match(source, /saveAs: false/);
  assert.match(source, /type: "register-download-target"/);
  assert.match(source, /type: "release-download-target"/);
  assert.match(background, /onDeterminingFilename/);

  assert.match(
    source,
    /downloadRelativePath\(\s*currentDownloadSubfolder\(\),\s*outputName,?\s*\)/,
  );

  assert.doesNotMatch(source, /showDirectoryPicker/);
  assert.doesNotMatch(source, /showSaveFilePicker/);
  const popup = await readFile(new URL("popup.ts", root), "utf8");

  assert.doesNotMatch(popup, /chrome:\/\/settings\/downloads/);
});

test("should schedule a matching MP4 subtitle without a second picker", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  ) as ExtensionManifest;

  const source = await readFile(new URL("app.ts", root), "utf8");
  const background = await readFile(new URL("background.ts", root), "utf8");

  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(!manifest.permissions.includes("contentSettings"));

  assert.match(
    source,
    /saveBrowserDownload\(contents, subtitleName, "text\/vtt"\)/,
  );

  assert.doesNotMatch(source, /saveSubtitleInDownloads/);
  assert.doesNotMatch(background, /chrome\.downloads\.download/);

  assert.match(
    source,
    /subtitleFilename\(\s*outputFilename,\s*selectedSubtitleTrack\.url,?\s*\)/,
  );
});

test("should use a conventional FFmpeg MP4 remux instead of Media Source fragments", async () => {
  const source = await readFile(new URL("app.ts", root), "utf8");

  assert.match(source, /new FFmpeg\(\)/);

  assert.match(
    source,
    /classWorkerURL: chrome\.runtime\.getURL\("vendor\/ffmpeg\/worker\.js"\)/,
  );

  assert.match(source, /The MP4 engine took too long to start/);
  assert.match(source, /setBusy\(true, true\)/);
  assert.match(source, /downloadControlState\(/);
  assert.match(source, /"-c:v",\s*"copy"/);
  assert.match(source, /"-movflags",\s*"\+faststart"/);
  assert.match(source, /ffmpeg\.mountOpfs\(/);
  assert.match(source, /ffmpeg\.unmountOpfs\(/);
  assert.match(source, /type: "set-download-tab-keepalive"/);
  assert.doesNotMatch(source, /createMp4Remuxer/);

  const background = await readFile(new URL("background.ts", root), "utf8");

  const ffmpegClasses = await readFile(
    new URL("vendor/ffmpeg/classes.js", root),
    "utf8",
  );

  assert.match(background, /"set-download-tab-keepalive"/);
  assert.match(background, /autoDiscardable:/);
  assert.match(background, /"export-diagram-svg"/);
  assert.match(background, /"export-slides-pdf"/);
  assert.match(background, /decodeSubtitleBytes/);
  assert.match(source, /decodeSubtitleBytes/);
  assert.match(source, /repairDoubleEncodedUtf8/);
  assert.match(ffmpegClasses, /#worker\.onerror\s*=/);
});

test("should offer MP4 sidecar and MKV embedded subtitle output", async () => {
  const page = await readFile(new URL("index.html", root), "utf8");
  const source = await readFile(new URL("app.ts", root), "utf8");

  assert.match(source, /OUTPUT_FORMAT_OPTIONS/);
  assert.match(page, /download-subfolder-status/);
  assert.match(source, /"-c:s", "webvtt"/);
  assert.match(source, /"-disposition:s:0", "default"/);
  assert.match(source, /outputFormat === "mkv"/);
});

test("should ship bundled popup, downloader, and course scripts with no bare module imports", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  ) as ExtensionManifest;

  const popupHtml = await readFile(new URL("popup.html", root), "utf8");
  const indexHtml = await readFile(new URL("index.html", root), "utf8");
  const courseHtml = await readFile(new URL("playlist.html", root), "utf8");

  assert.equal(manifest.background.service_worker, "dist/background.js");
  assert.deepEqual(manifest.content_scripts[0]?.js, ["dist/content.js"]);

  assert.deepEqual(manifest.content_scripts[1]?.js, [
    "dist/page-playlist-probe.js",
  ]);

  assert.match(popupHtml, /src="dist\/popup\.js"/);
  assert.match(indexHtml, /src="dist\/app\.js"/);
  assert.match(courseHtml, /src="dist\/playlist\.js"/);

  const popupBundle = await readFile(new URL("dist/popup.js", root), "utf8");
  const appBundle = await readFile(new URL("dist/app.js", root), "utf8");

  assert.ok(popupBundle.length > 5000);
  assert.ok(appBundle.length > 10000);
  assert.doesNotMatch(popupBundle, /from\s+["']lucide["']/);
  assert.doesNotMatch(appBundle, /from\s+["']lucide["']/);
});

test("should hand off the preferred format and start the download immediately", async () => {
  const popup = await readFile(new URL("popup.ts", root), "utf8");
  const app = await readFile(new URL("app.ts", root), "utf8");
  const background = await readFile(new URL("background.ts", root), "utf8");

  assert.match(popup, /outputFormat: output\.value,\s*autoStart: true/);
  assert.match(app, /if \(autoStart\) await startDownload\(\)/);
  assert.match(background, /\[key\]: \{ \.\.\.download, autoStart: false \}/);
  assert.match(popup, /uniqueKnownSubtitleTracks/);
  assert.match(popup, /sourceUrl: activePageUrl \|\| stream\.sourceUrl/);
  assert.match(popup, /sourceTabId: tabId/);
  assert.match(popup, /navigator\.clipboard\.writeText\(stream\.url\)/);

  assert.match(
    popup,
    /copyUrl\.replaceChildren\(icon\("check", \["icon"\]\)\)/,
  );

  assert.doesNotMatch(popup, /Source playlist/);
  assert.match(popup, /quality\.className = "quality"/);
  assert.match(popup, /qualityOptions/);
  assert.match(app, /suppliedQualityChoices/);
  assert.match(popup, /currentStreams\.open = true/);
  assert.match(popup, /uniqueStreams/);
});

test("should keep course scanning headless without main-window tab fallbacks or invalid minimized options", async () => {
  const background = await readFile(new URL("background.ts", root), "utf8");
  const backgroundCode = background.replace(/\/\/[^\n]*/g, "");
  const content = await readFile(new URL("content.ts", root), "utf8");

  const courseProbe = await readFile(
    new URL("page-playlist-probe.ts", root),
    "utf8",
  );

  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  ) as ExtensionManifest;

  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.content_scripts[0]?.all_frames);
  assert.ok(manifest.content_scripts[1]?.all_frames);
  assert.equal(manifest.content_scripts[1]?.world, "MAIN");
  assert.equal(manifest.content_scripts[1]?.matches[0], "https://*/courses/*");
  assert.equal(manifest.web_accessible_resources, undefined);

  // Tier 1 + Tier 1.5 hidden iframe + Tier 2 minimized popup contracts
  assert.match(background, /ensureMainWorldProbeInjected/);
  assert.match(background, /runHiddenIframeScan/);
  assert.match(background, /resolveHiddenFrameProbe/);
  assert.match(background, /openMinimizedWorkerTab/);
  assert.match(background, /state: "minimized"/);

  assert.doesNotMatch(
    backgroundCode,
    /state:\s*"minimized"[\s\S]{0,120}focused:\s*false|focused:\s*false[\s\S]{0,120}state:\s*"minimized"/,
  );

  assert.doesNotMatch(background, /chrome\.tabs\.hide/);
  assert.match(content, /open-hidden-probe-frame/);
  assert.match(content, /hidden-probe-frame-ready/);
  assert.match(content, /close-hidden-probe-frame/);
  assert.match(courseProbe, /__opfsMediaPackagerProbeLoaded/);
  assert.match(courseProbe, /fetchApiPlaylistWithBackoff/);
  assert.match(courseProbe, /DecompressionStream\("deflate"\)/);
  assert.doesNotMatch(courseProbe, /JSON\.parse =/);
});

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
