import { test, expect } from "../support/extension.ts";
import {
  type RecordedCourseMessage,
  type MockChromeWindow,
  contentScript,
  type RuntimeMessageHandler,
} from "./support/playlist-page.ts";

test("should manage invisible offscreen probe iframes cleanly and suppress outline/location messages inside them", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    const childMessages: RecordedCourseMessage[] = [];

    await page.exposeFunction("__childMessage", (msg: RecordedCourseMessage) =>
      childMessages.push(msg),
    );

    await page.route("https://training.example/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><main>Course</main></body></html>",
      });
    });

    await page.goto("https://training.example/courses/abc/1/2/3/conteudos");

    await page.evaluate((src: string) => {
      const win = window as unknown as MockChromeWindow;

      win.__onMsg = null;

      win.chrome = {
        runtime: {
          sendMessage() {
            return Promise.resolve({ ok: true });
          },
          onMessage: {
            addListener(fn: RuntimeMessageHandler) {
              win.__onMsg = fn;
            },
          },
        },
      };

      (0, eval)(src);
    }, contentScript);

    const openResult = await page.evaluate(async () => {
      const win = window as unknown as MockChromeWindow;

      return await new Promise<Record<string, unknown>>((done) => {
        win.__onMsg?.(
          {
            type: "open-hidden-probe-frame",
            probeId: "probe-xyz",
            url: "https://training.example/courses/abc/1/2/3/conteudos?conteudo=2",
          },
          {},
          done,
        );
      });
    });

    expect(openResult.ok).toBe(true);

    const iframeStyle = await page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[name="opfs-media-packager-probe:probe-xyz"]',
      );

      if (!iframe) return null;

      return {
        name: iframe.name,
        width: iframe.style.width,
        height: iframe.style.height,
        opacity: iframe.style.opacity,
        left: iframe.style.left,
        pointerEvents: iframe.style.pointerEvents,
      };
    });

    expect(iframeStyle).toEqual({
      name: "opfs-media-packager-probe:probe-xyz",
      width: "1440px",
      height: "900px",
      opacity: "0",
      left: "-9999px",
      pointerEvents: "none",
    });

    const childFrame = page
      .frames()
      .find((f) => f.name() === "opfs-media-packager-probe:probe-xyz");

    expect(childFrame).toBeTruthy();
    if (!childFrame) throw new Error("Expected hidden probe child frame");
    await childFrame.waitForLoadState("domcontentloaded");

    await childFrame.evaluate((src: string) => {
      const win = window as unknown as MockChromeWindow;
      const parentWin = window.parent as unknown as MockChromeWindow;

      win.chrome = {
        runtime: {
          sendMessage(msg: unknown) {
            parentWin.__childMessage?.(msg);

            return Promise.resolve({ ok: true });
          },
          onMessage: { addListener() {} },
        },
      };

      (0, eval)(src);
    }, contentScript);

    await expect
      .poll(
        () =>
          childMessages.some(
            (m) =>
              m?.type === "hidden-probe-frame-ready" &&
              m.probeId === "probe-xyz",
          ),
        { timeout: 2000 },
      )
      .toBe(true);

    expect(childMessages.some((m) => m?.type === "playlist-outline")).toBe(
      false,
    );

    expect(childMessages.some((m) => m?.type === "page-location")).toBe(false);

    await page.evaluate(async () => {
      const win = window as unknown as MockChromeWindow;

      await new Promise<Record<string, unknown>>((done) => {
        win.__onMsg?.(
          { type: "close-hidden-probe-frame", probeId: "probe-xyz" },
          {},
          done,
        );
      });
    });

    await expect(
      page.locator('iframe[name^="opfs-media-packager-probe:"]'),
    ).toHaveCount(0);
  } finally {
    await page.close();
  }
});
