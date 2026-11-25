import {
  test as base,
  expect,
  chromium,
  type Browser,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export interface ExtensionFixture {
  readonly context: BrowserContext;
  readonly downloadsDir: string;
  readonly extensionId: string;
  readonly serviceWorker: Worker;
}

export const extensionPath = resolvePath(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const browserProfilePrefix = resolvePath(tmpdir(), "opfs-media-packager-e2e-");

function executableOption():
  { readonly executablePath: string } | { readonly channel: "chromium" } {
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : { channel: "chromium" };
}

async function createProfileWithDownloads(
  downloadsDir: string,
): Promise<string> {
  const profile = await mkdtemp(browserProfilePrefix);

  await mkdir(resolvePath(profile, "Default"), { recursive: true });

  await writeFile(
    resolvePath(profile, "Default", "Preferences"),
    JSON.stringify({
      download: {
        default_directory: downloadsDir,
        prompt_for_download: false,
      },
    }),
  );

  return profile;
}

async function launchExtensionContext(downloadsDir: string): Promise<{
  readonly profile: string;
  readonly context: BrowserContext;
  readonly serviceWorker: Worker;
}> {
  for (const attempt of [1, 2]) {
    const profile = await createProfileWithDownloads(downloadsDir);

    try {
      const context = await chromium.launchPersistentContext(profile, {
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          "--host-resolver-rules=MAP *.example.test 127.0.0.1,MAP e2e.excalidraw.com 127.0.0.1",
        ],
        ...executableOption(),
        headless: true,
      });

      const serviceWorker =
        context.serviceWorkers()[0] ||
        (await context
          .waitForEvent("serviceworker", { timeout: 10000 })
          .catch(() => context.serviceWorkers()[0]));

      if (serviceWorker) return { profile, context, serviceWorker };
      await context.close().catch(() => {});
    } catch (error) {
      if (attempt === 2) {
        await rm(profile, { force: true, recursive: true }).catch(() => {});
        throw error;
      }
    }

    await rm(profile, { force: true, recursive: true }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error("Extension service worker timed out.");
}

export const test = base.extend<
  object,
  { sharedBrowser: Browser; extensionFixture: ExtensionFixture }
>({
  sharedBrowser: [
    async ({ browserName: _browserName }, use) => {
      const browser = await chromium.launch({
        headless: true,
        ...executableOption(),
      });

      try {
        await use(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: "worker" },
  ],
  extensionFixture: [
    async ({ browserName: _browserName }, use) => {
      const downloadsDir = await mkdtemp(
        resolvePath(tmpdir(), "opfs-media-packager-downloads-"),
      );

      const { profile, context, serviceWorker } =
        await launchExtensionContext(downloadsDir);

      const extensionId = new URL(serviceWorker.url()).host;

      try {
        await use({ context, downloadsDir, extensionId, serviceWorker });
      } finally {
        await context.close();
        await rm(profile, { force: true, recursive: true });
        await rm(downloadsDir, { force: true, recursive: true });
      }
    },
    { scope: "worker" },
  ],
});

export { expect };
