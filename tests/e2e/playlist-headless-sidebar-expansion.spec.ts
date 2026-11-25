import { test, expect } from "./fixtures/extension.ts";
import { contentScript } from "./fixtures/playlist-headless-fixtures.ts";

test("should expand collapsed sidebar sections and reset subtitle resource floor on navigate-course-sidebar", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    await page.route("**/*", async (route) => {
      const url = route.request().url();

      if (url.endsWith("/media_transcripts/lesson1.vtt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/vtt",
          body: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nPrimeira aula.\n",
        });

        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><head><title>Course</title></head><body>
          <aside aria-label="Barra lateral">
            <div><span>First Lesson</span><span>Aula</span></div>
            <button type="button" id="lesson-1-btn"><span>Second Lesson</span><span>Aula</span></button>
            <section>
              <button type="button" id="toggle-mod-2" aria-expanded="false">Module 2</button>
              <div id="mod-2-body"></div>
            </section>
          </aside>
          <script>
            window.__events = [];
            document.getElementById("toggle-mod-2").addEventListener("click", (e) => {
              const btn = e.currentTarget;
              btn.setAttribute("aria-expanded", "true");
              window.__events.push("expanded-mod-2");
              const hiddenBtn = document.createElement("button");
              hiddenBtn.type = "button";
              hiddenBtn.id = "hidden-lesson-btn";
              hiddenBtn.innerHTML = "<span>Hidden Lesson</span><span>Aula</span>";
              hiddenBtn.addEventListener("click", () => window.__events.push("clicked-hidden-lesson"));
              document.getElementById("mod-2-body").append(hiddenBtn);
            });
          </script>
        </body></html>`,
      });
    });

    await page.goto("https://training.example/c/ai/sections/1/lessons/10");

    await page.evaluate(async () => {
      await (
        await fetch("https://training.example/media_transcripts/lesson1.vtt")
      ).text();
    });

    await page.addScriptTag({
      content: `
        window.__runtimeListeners = [];
        window.chrome = {
          runtime: {
            sendMessage() { return Promise.resolve({ ok: true }); },
            onMessage: { addListener(fn) { window.__runtimeListeners.push(fn); } }
          }
        };
      `,
    });

    await page.addScriptTag({ content: contentScript });

    const outcome = await page.evaluate(async () => {
      const win = window as unknown as {
        readonly __events: string[];
        readonly __runtimeListeners: ((
          msg: Record<string, unknown>,
          sender: Record<string, unknown>,
          sendResponse: (value: unknown) => void,
        ) => unknown)[];
      };

      const dispatch = (msg: Record<string, unknown>): Promise<unknown> =>
        new Promise((resolve) => {
          for (const listener of win.__runtimeListeners) {
            listener(msg, {}, resolve);
          }
        });

      const beforeTracks = await dispatch({ type: "collect-page-subtitles" });

      const navResult = await dispatch({
        type: "navigate-playlist-sidebar",
        itemIndex: 1,
        itemTitle: "2.1 Hidden Lesson",
      });

      const afterTracks = await dispatch({ type: "collect-page-subtitles" });

      return {
        beforeTracks,
        navResult,
        afterTracks,
        events: [...win.__events],
      };
    });

    expect(outcome.beforeTracks).toEqual({
      tracks: [
        {
          url: "https://training.example/media_transcripts/lesson1.vtt",
          language: "Subtitle",
          label: "",
        },
      ],
    });

    expect(outcome.navResult).toEqual({ ok: true });
    expect(outcome.events).toEqual(["expanded-mod-2", "clicked-hidden-lesson"]);
    expect(outcome.afterTracks).toEqual({ tracks: [] });
  } finally {
    await page.close();
  }
});
