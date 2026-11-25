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

if (missing.length > 0) {
  console.error(`Missing extension files:\n${missing.join("\n")}`);
  process.exit(1);
}

console.log("All extension scripts exist.");
