import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { test, expect, extensionPath } from "./fixtures.ts";

interface PlaylistOutlineLesson {
  readonly url: string;
  readonly folderPath: readonly string[];
}

interface PlaylistOutlinePayload {
  readonly title: string;
  readonly items: readonly PlaylistOutlineLesson[];
}

interface RecordedCourseMessage {
  readonly type?: string;
  readonly probeId?: string;
  readonly outline?: PlaylistOutlinePayload;
}

type RuntimeMessageHandler = (
  message: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response: Record<string, unknown>) => void,
) => void;

interface MockChromeWindow {
  __recordMessage?: (msg: unknown) => void;
  __childMessage?: (msg: unknown) => void;
  __onMsg?: RuntimeMessageHandler | null;
  chrome?: {
    runtime: {
      sendMessage: (msg: unknown) => Promise<{ ok: boolean }>;
      onMessage: {
        addListener: (fn: RuntimeMessageHandler) => void;
      };
    };
  };
}

const contentScript = await readFile(
  resolvePath(extensionPath, "dist/content.js"),
  "utf8",
);

test("should extract all 35 multi-chapter API-route lessons updating both pathname chapter and query params", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    const sentMessages: RecordedCourseMessage[] = [];

    await page.exposeFunction("__recordMessage", (msg: RecordedCourseMessage) =>
      sentMessages.push(msg),
    );

    await page.route("https://training.example/**", (route) => {
      const chapters = Array.from({ length: 5 }, (_chapter, cIdx) => {
        const chapterId = 136 + cIdx;

        const items = Array.from({ length: 7 }, (_item, lIdx) => {
          const contentId = 7465 + cIdx * 7 + lIdx;

          return `<div id="list-content-${contentId}"><span>Aula ${cIdx + 1}.${lIdx + 1}</span></div>`;
        }).join("");

        return `<section id="chapter-${chapterId}"><h3>Capítulo ${cIdx + 1}</h3>${items}</section>`;
      }).join("");

      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>Curso Completo</title></head><body><h1>Sistemas Distribuídos</h1>${chapters}</body></html>`,
      });
    });

    await page.goto(
      "https://training.example/courses/33333333-3333-4333-8333-333333333333/177/168/136/conteudos?capitulo=136&conteudo=7465",
    );

    await page.evaluate((src: string) => {
      const win = window as unknown as MockChromeWindow;

      win.chrome = {
        runtime: {
          sendMessage(msg: unknown) {
            win.__recordMessage?.(msg);

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
          [...sentMessages]
            .reverse()
            .find((msg) => msg?.type === "playlist-outline")?.outline?.items
            ?.length ?? 0,
        { timeout: 3000 },
      )
      .toBe(35);

    const outlineMsg = [...sentMessages]
      .reverse()
      .find((msg) => msg?.type === "playlist-outline");

    const outline = outlineMsg?.outline;

    expect(outline).toBeTruthy();
    if (!outline) throw new Error("Expected course-outline message");
    const lastLesson = outline.items[34];

    expect(lastLesson.url).toContain("/177/168/140/conteudos");
    expect(lastLesson.url).toContain("capitulo=140");
    expect(lastLesson.url).toContain("conteudo=7499");
  } finally {
    await page.close();
  }
});

test("should extract all 21 sidebar-button lessons with true section folders and ignore hidden blocked-lesson text", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    const sentMessages: RecordedCourseMessage[] = [];

    await page.exposeFunction("__recordMessage", (msg: RecordedCourseMessage) =>
      sentMessages.push(msg),
    );

    await page.route("https://training.example/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><head><title>Curso Sidebar</title></head><body><div id='root'></div></body></html>",
      });
    });

    await page.goto("https://training.example/c/eng/sections/10/lessons/100");

    await page.evaluate((src: string) => {
      const win = window as unknown as MockChromeWindow;

      win.chrome = {
        runtime: {
          sendMessage(msg: unknown) {
            win.__recordMessage?.(msg);

            return Promise.resolve({ ok: true });
          },
          onMessage: { addListener() {} },
        },
      };

      (0, eval)(src);
    }, contentScript);

    await page.evaluate(() => {
      const makeBtn = (title: string, badge = "Aula"): string =>
        `<button type="button" class="lesson-btn"><span>${title}</span><span>10:00</span><span>${badge}</span></button>`;

      const root = document.getElementById("root");

      if (!root) return;

      root.innerHTML = `
        <header><h1>Engenharia Moderna</h1><button>Concluído</button></header>
        <aside>
          <div class="section-card">
            <div class="card-header"><span>Fundamentos</span><span class="sr-only">Aula bloqueada</span></div>
            <div class="active-lesson"><span>Boas-vindas</span><span>05:00</span><span>Concluído</span></div>
            ${Array.from({ length: 6 }, (_item, i) => makeBtn(`Fundamento ${i + 2}`, i < 2 ? "Concluído" : "Aula")).join("")}
          </div>
          <div class="section-card">
            <div class="card-header"><span>Arquitetura</span></div>
            ${Array.from({ length: 7 }, (_item, i) => makeBtn(`Arquitetura ${i + 1}`)).join("")}
          </div>
          <div class="section-card">
            <div class="card-header"><span>Prática</span></div>
            ${Array.from({ length: 7 }, (_item, i) => makeBtn(`Prática ${i + 1}`)).join("")}
          </div>
        </aside>
      `;
    });

    await expect
      .poll(
        () =>
          [...sentMessages]
            .reverse()
            .find((msg) => msg?.type === "playlist-outline")?.outline?.items
            ?.length ?? 0,
        { timeout: 3000 },
      )
      .toBe(21);

    const outlineMsg = [...sentMessages]
      .reverse()
      .find((msg) => msg?.type === "playlist-outline");

    const outline = outlineMsg?.outline;

    expect(outline).toBeTruthy();
    if (!outline) throw new Error("Expected course-outline message");
    expect(outline.title).toBe("Engenharia Moderna");

    expect(outline.items[0].folderPath[0]).toBe(
      "(Playlist) Engenharia Moderna",
    );

    expect(outline.items[0].folderPath).toContain("1. Fundamentos");
    expect(outline.items[7].folderPath).toContain("2. Arquitetura");
    expect(outline.items[14].folderPath).toContain("3. Prática");

    for (const lesson of outline.items) {
      expect(lesson.folderPath.join(" / ")).not.toContain("Aula bloqueada");
    }
  } finally {
    await page.close();
  }
});

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

test("should display subtitle language (never generic Subtitle) and filter selected lessons on playlist.html", async ({
  extensionFixture,
}) => {
  const { context, extensionId, serviceWorker } = extensionFixture;

  await serviceWorker.evaluate(async () => {
    await chrome.storage.session.set({
      "playlist-scan:ui-e2e": {
        id: "ui-e2e",
        title: "Distributed Systems",
        status: "ready",
        nextItemIndex: 3,
        items: [
          {
            id: "1",
            url: "https://training.example/courses/a?conteudo=1",
            fileTitle: "1.1 Intro",
            folderPath: ["Playlist"],
          },
          {
            id: "2",
            url: "https://training.example/courses/a?conteudo=2",
            fileTitle: "1.2 Messaging",
            folderPath: ["Playlist"],
          },
          {
            id: "3",
            url: "https://training.example/courses/a?conteudo=3",
            fileTitle: "1.3 Storage",
            folderPath: ["Playlist"],
          },
        ],
        discovered: [
          {
            itemIndex: 0,
            title: "1.1 Intro",
            folderPath: ["Playlist"],
            url: "https://media.example.net/1/playlist.m3u8",
            qualityOptions: [
              { label: "1080p", url: "https://media.example.net/1/1080.m3u8" },
              { label: "720p", url: "https://media.example.net/1/720.m3u8" },
              { label: "480p", url: "https://media.example.net/1/480.m3u8" },
            ],
            subtitles: [
              {
                url: "https://media.example.net/1/pt.vtt",
                language: "Portuguese",
                label: "pt.vtt",
              },
            ],
          },
          {
            itemIndex: 1,
            title: "1.2 Messaging",
            folderPath: ["Playlist"],
            url: "https://media.example.net/2/playlist.m3u8",
            qualityOptions: [
              { label: "720p", url: "https://media.example.net/2/720.m3u8" },
            ],
            subtitles: [
              {
                url: "https://media.example.net/2/en.vtt",
                language: "English",
                label: "en.vtt",
              },
            ],
          },
          {
            itemIndex: 2,
            title: "1.3 Storage",
            folderPath: ["Playlist"],
            url: "https://media.example.net/3/playlist.m3u8",
            qualityOptions: [
              { label: "1080p", url: "https://media.example.net/3/1080.m3u8" },
            ],
            subtitles: [],
          },
        ],
      },
    });
  });

  const page = await context.newPage();

  try {
    await page.goto(
      `chrome-extension://${extensionId}/playlist.html?scan=ui-e2e`,
    );

    await expect(page.locator("#items li")).toHaveCount(3);

    await expect(page.locator(".item-meta").nth(0)).toHaveText(
      "3 quality options · Portuguese",
    );

    await expect(page.locator(".item-meta").nth(1)).toHaveText(
      "1 quality option · English",
    );

    await expect(page.locator("#selection-count")).toHaveText(
      "3 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toHaveText(
      "Download all 3 items",
    );

    await page.locator(".item-select").nth(1).uncheck();

    await expect(page.locator("#selection-count")).toHaveText(
      "2 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toHaveText(
      "Download 2 selected items",
    );

    await page.locator("#deselect-all").click();

    await expect(page.locator("#selection-count")).toHaveText(
      "0 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toBeDisabled();

    await page.locator("#select-all").click();

    await expect(page.locator("#selection-count")).toHaveText(
      "3 of 3 videos selected",
    );

    await expect(page.locator("#download-all")).toBeEnabled();
  } finally {
    await page.close();
  }
});

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

test("should extract all 21 lessons across large, medium, and small responsive breakpoints even when aside unmounts below 1024px and 2 stray links exist", async ({
  sharedBrowser,
}) => {
  const responsiveCourseHtml = `<!doctype html><html><head><title>Curso Exemplo</title></head><body>
    <header><span>Curso Exemplo</span><button>Concluir aula</button></header>
    <nav aria-label="Lesson navigation">
      <a href="/c/sample-course/sections/101/lessons/1002">Aula 2</a>
      <a href="/c/sample-course/sections/101/lessons/1003">Aula 3</a>
    </nav>
    <div id="layout"></div>
    <main>
      <h2>Introdução ao Curso de Exemplo</h2>
    </main>
    <script>
      if (window.innerWidth >= 1024) {
        const aside = document.createElement("aside");
        aside.setAttribute("aria-label", "Barra lateral");
        const active = document.createElement("div");
        active.innerHTML = "<span>Introdução ao Curso de Exemplo</span><span>Aula</span>";
        aside.append(active);
        for (let i = 2; i <= 21; i += 1) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.innerHTML = "<span>Aula " + i + "</span><span>Aula</span>";
          aside.append(btn);
        }
        document.getElementById("layout").append(aside);
      }
    </script>
  </body></html>`;

  const breakpoints = [
    { name: "large", width: 1440, height: 900, expectVisibleAside: true },
    { name: "medium", width: 820, height: 900, expectVisibleAside: false },
    { name: "small", width: 600, height: 900, expectVisibleAside: false },
  ] as const;

  for (const breakpoint of breakpoints) {
    const context = await sharedBrowser.newContext({
      viewport: { width: breakpoint.width, height: breakpoint.height },
    });

    try {
      await context.route("**/*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: responsiveCourseHtml,
        });
      });

      await context.addInitScript(`
        window.__messages = [];
        window.__runtimeListeners = [];
        window.chrome = {
          runtime: {
            sendMessage(msg) { window.__messages.push(msg); return Promise.resolve({ ok: true }); },
            onMessage: { addListener(fn) { window.__runtimeListeners.push(fn); } }
          }
        };
      `);

      await context.addInitScript({ content: contentScript });
      const page = await context.newPage();

      await page.goto(
        "https://training.example/c/sample-course/sections/101/lessons/1001",
        { waitUntil: "domcontentloaded" },
      );

      const visibleAsideCount = await page.locator("aside").count();

      expect(
        visibleAsideCount > 0,
        `${breakpoint.name} viewport aside visibility`,
      ).toBe(breakpoint.expectVisibleAside);

      await expect
        .poll(
          async () => {
            return await page.evaluate(() => {
              const win = window as unknown as {
                readonly __messages: readonly {
                  readonly type?: string;
                  readonly outline?: { readonly items?: readonly unknown[] };
                }[];
              };

              const outlines = win.__messages.filter(
                (msg) => msg.type === "playlist-outline",
              );

              return outlines.at(-1)?.outline?.items?.length ?? 0;
            });
          },
          { timeout: 6000 },
        )
        .toBe(21);

      // Temporary offscreen desktop iframe must be cleaned up immediately after extraction.
      await expect(page.locator("iframe")).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

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

test("should extract all 10 workshop session items with Sessão badges, 5 sessões section headers, and custom thumbnail badges instead of falling back to 2 serialized URLs", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    const sentMessages: RecordedCourseMessage[] = [];

    await page.exposeFunction("__recordMessage", (msg: RecordedCourseMessage) =>
      sentMessages.push(msg),
    );

    await page.route("https://training.example/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>Workshop Exemplo</title></head><body>
          <script type="application/json">{"next":"/c/workshop/sections/10/lessons/102","current":"/c/workshop/sections/10/lessons/101"}</script>
          <div id="root"></div>
        </body></html>`,
      });
    });

    await page.goto(
      "https://training.example/c/workshop/sections/10/lessons/101",
    );

    await page.evaluate((src: string) => {
      const win = window as unknown as MockChromeWindow;

      win.chrome = {
        runtime: {
          sendMessage(msg: unknown) {
            win.__recordMessage?.(msg);

            return Promise.resolve({ ok: true });
          },
          onMessage: { addListener() {} },
        },
      };

      (0, eval)(src);
    }, contentScript);

    await page.evaluate(() => {
      const makeSessionBtn = (title: string, badge = "Sessão"): string =>
        `<button type="button"><img src="https://cdn.example/thumb.jpg" alt="" /><div><div>${title}</div><span>${badge}</span></div></button>`;

      const root = document.getElementById("root");

      if (!root) return;

      root.innerHTML = `
        <header><h1>Workshop Exemplo</h1><button>Concluir sessão</button></header>
        <aside aria-label="Barra lateral">
          <button type="button" aria-label="Voltar ao curso"></button>
          <div>
            <div><span>Dia 1: Desenvolvendo Fluxos</span><span>5 sessões</span></div>
            <div class="active-row"><img src="https://cdn.example/thumb.jpg" alt="" /><div><div>Sessão 1 Ativa</div><span>Sessão</span></div></div>
            ${makeSessionBtn("Sessão 2")}
            ${makeSessionBtn("Sessão 3")}
            ${makeSessionBtn("Sessão 4")}
            ${makeSessionBtn("Sessão 5", "Mentoria")}
          </div>
          <div>
            <div><span>Dia 2: Modelos e Workflows</span><span>5 sessões</span></div>
            ${makeSessionBtn("Sessão 6")}
            ${makeSessionBtn("Sessão 7")}
            ${makeSessionBtn("Sessão 8")}
            ${makeSessionBtn("Sessão 9")}
            ${makeSessionBtn("Sessão 10")}
          </div>
        </aside>
      `;
    });

    await expect
      .poll(
        () =>
          [...sentMessages]
            .reverse()
            .find((msg) => msg?.type === "playlist-outline")?.outline?.items
            ?.length ?? 0,
        { timeout: 3000 },
      )
      .toBe(10);

    const outline = [...sentMessages]
      .reverse()
      .find((msg) => msg?.type === "playlist-outline")?.outline;

    expect(outline).toBeTruthy();
    if (!outline) throw new Error("Expected workshop course-outline");

    expect(outline.items[0].folderPath[0]).toBe("(Workshop) Workshop Exemplo");

    expect(outline.items[0].folderPath).toContain(
      "1. Dia 1: Desenvolvendo Fluxos",
    );

    expect(outline.items[5].folderPath).toContain(
      "2. Dia 2: Modelos e Workflows",
    );
  } finally {
    await page.close();
  }
});

test("should filter embed preview and player poster images and disambiguate duplicate or punctuated sidebar titles", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    await page.route("**/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>Sample Course</title></head><body>
          <aside aria-label="Barra lateral">
            <section>
              <h3>Introdução</h3>
              <div class="active-lesson"><span>Introdução</span><span>Aula</span></div>
              <button type="button" id="btn-links"><span>Notas, recursos, exemplos</span><span>Aula</span></button>
            </section>
            <section>
              <h3>Modulo Evolutivo</h3>
              <button type="button" id="btn-dup-intro"><span>Introdução</span><span>Aula</span></button>
            </section>
          </aside>
          <main>
            <h1>Prévia do Curso</h1>
            <div data-testid="tip-tap-editor-content">
              <img class="ProseMirror-separator" alt="" />
              <div class="node-embed">
                <a href="https://training.example/c/eventos/previa">
                  <img src="https://assets.example.net/embed-card-thumb.png" alt="Preview" />
                </a>
              </div>
              <div data-component="VideoPlayer">
                <img src="https://assets.example.net/player-poster.jpg" alt="Poster" />
              </div>
              <p>Diagramas reais:</p>
              <img src="https://assets.example.net/real-diagram-1.png" alt="Real 1" />
              <img data-src="https://assets.example.net/real-diagram-2.png" alt="Real 2" />
            </div>
          </main>
          <script>
            window.__clicked = [];
            document.getElementById("btn-links").addEventListener("click", () => window.__clicked.push("links"));
            document.getElementById("btn-dup-intro").addEventListener("click", () => window.__clicked.push("dup-intro"));
          </script>
        </body></html>`,
      });
    });

    await page.goto(
      "https://training.example/c/sample-course/sections/1/lessons/10",
    );

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
        readonly __clicked: string[];
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

      const materialsRes = await dispatch({ type: "extract-item-documents" });

      const navPunctuated = await dispatch({
        type: "navigate-playlist-sidebar",
        itemIndex: 99,
        itemTitle: "1.4 Notas recursos exemplos",
        itemSection: "1. Introdução",
      });

      const navDuplicate = await dispatch({
        type: "navigate-playlist-sidebar",
        itemIndex: 99,
        itemTitle: "9.1 Introdução",
        itemSection: "9. Modulo Evolutivo",
      });

      return {
        materialsRes,
        navPunctuated,
        navDuplicate,
        clicked: [...win.__clicked],
      };
    });

    const materialsPayload = (
      outcome.materialsRes as {
        readonly documents?: {
          readonly images?: readonly { readonly url: string }[];
        };
      }
    )?.documents;

    expect(materialsPayload?.images?.map((img) => img.url)).toEqual([
      "https://assets.example.net/real-diagram-1.png",
      "https://assets.example.net/real-diagram-2.png",
    ]);

    expect(outcome.navPunctuated).toEqual({ ok: true });
    expect(outcome.navDuplicate).toEqual({ ok: true });
    expect(outcome.clicked).toEqual(["links", "dup-intro"]);
  } finally {
    await page.close();
  }
});
