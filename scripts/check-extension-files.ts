// Verifies that every local script an extension page loads actually exists,
// so a release cannot ship with a popup that silently loads nothing.
import { existsSync, readFileSync } from "node:fs";

interface ManifestContentScript {
  readonly js?: readonly string[];
}

interface ExtensionManifest {
  readonly background?: { readonly service_worker?: string };
  readonly content_scripts?: readonly ManifestContentScript[];
}

interface BundleSourceMap {
  readonly sources: readonly string[];
}

const pages = ["popup.html", "index.html", "playlist.html"] as const;

const manifest = JSON.parse(
  readFileSync("manifest.json", "utf8"),
) as ExtensionManifest;

const missing: string[] = [];

for (const page of pages) {
  const html = readFileSync(page, "utf8");

  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    const scriptPath = match[1];

    if (scriptPath && !existsSync(scriptPath)) {
      missing.push(`${page} -> ${scriptPath}`);
    }
  }
}

const scripts = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
].filter((script): script is string => Boolean(script));

for (const script of scripts) {
  if (!existsSync(script)) missing.push(`manifest.json -> ${script}`);
}

const bundles = [
  "app",
  "background",
  "content",
  "page-playlist-probe",
  "playlist",
  "popup",
];

const testSources: string[] = [];

for (const bundle of bundles) {
  const mapPath = `dist/${bundle}.js.map`;

  const sourceMap = JSON.parse(
    readFileSync(mapPath, "utf8"),
  ) as BundleSourceMap;

  for (const source of sourceMap.sources) {
    const normalized = source.replaceAll("\\", "/");

    if (
      /(?:^|\/)(?:tests|mocks|__mocks__)(?:\/|$)/.test(normalized) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    ) {
      testSources.push(`${mapPath} -> ${source}`);
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing extension files:\n${missing.join("\n")}`);
  process.exit(1);
}

if (testSources.length > 0) {
  console.error(
    `Test sources included in extension bundles:\n${testSources.join("\n")}`,
  );

  process.exit(1);
}

console.log("All extension scripts exist.");
