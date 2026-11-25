import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

const root = new URL("../../", import.meta.url);

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
