import { test, expect } from "../support/extension.ts";
import { contentScript } from "./support/playlist-page.ts";

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
