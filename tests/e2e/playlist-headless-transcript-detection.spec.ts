import { test, expect } from "./fixtures/extension.ts";
import { contentScript } from "./fixtures/playlist-headless-fixtures.ts";

test("should recover eager page transcript VTTs while ignoring blob tracks and mosaic.vtt, and extract main h2 lesson heading", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    await page.route("**/*", async (route) => {
      const url = route.request().url();

      if (url.endsWith("/media_transcripts/3824457.vtt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/vtt",
          body: "WEBVTT\n\n00:00:00.080 --> 00:00:02.240\nOlá pessoal, vamos começar.\n",
        });

        return;
      }

      if (url.endsWith("/mosaic.vtt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/vtt",
          body: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nmosaic.jpg#xywh=0,0,160,90\n",
        });

        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>Curso Completo | Portal</title></head><body>
          <main>
            <h2>Introdução ao Curso de Exemplo</h2>
            <hls-video>
              <track kind="captions" label="Padrão" src="blob:https://training.example/00000000-0000-0000-0000-000000000001" srclang="en" default />
              <track kind="metadata" label="thumbnails" src="https://training.example/mosaic.vtt" default />
            </hls-video>
          </main>
        </body></html>`,
      });
    });

    await page.goto(
      "https://training.example/c/sample-course/sections/101/lessons/1001",
    );

    // Simulate eager page fetches that occur before the extension popup opens.
    await page.evaluate(async () => {
      await (await fetch("https://training.example/mosaic.vtt")).text();

      await (
        await fetch("https://training.example/media_transcripts/3824457.vtt")
      ).text();
    });

    await page.addScriptTag({
      content: `
        window.__messages = [];
        window.__runtimeListeners = [];
        window.chrome = {
          runtime: {
            sendMessage(msg) { window.__messages.push(msg); return Promise.resolve({ ok: true }); },
            onMessage: { addListener(fn) { window.__runtimeListeners.push(fn); } }
          }
        };
      `,
    });

    await page.addScriptTag({ content: contentScript });

    const inspection = await page.evaluate(() => {
      const win = window as unknown as {
        readonly __runtimeListeners: ((
          msg: Record<string, unknown>,
          sender: Record<string, unknown>,
          sendResponse: (value: unknown) => void,
        ) => unknown)[];
      };

      const dispatch = (msg: Record<string, unknown>): unknown => {
        const result = { value: null as unknown };

        for (const listener of win.__runtimeListeners) {
          listener(msg, {}, (response) => {
            result.value = response;
          });
        }

        return result.value;
      };

      return {
        heading: dispatch({ type: "get-page-heading" }),
        subtitles: dispatch({ type: "collect-page-subtitles" }),
      };
    });

    expect(inspection.heading).toEqual({
      title: "Introdução ao Curso de Exemplo",
    });

    expect(inspection.subtitles).toEqual({
      tracks: [
        {
          url: "https://training.example/media_transcripts/3824457.vtt",
          language: "Subtitle",
          label: "",
        },
      ],
    });
  } finally {
    await page.close();
  }
});
