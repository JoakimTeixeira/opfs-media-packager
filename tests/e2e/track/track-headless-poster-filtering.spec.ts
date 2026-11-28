import { test, expect } from "../support/extension.ts";
import { contentScript } from "./support/track-page.ts";

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

      const materialsRes = await dispatch({ type: "extract-topic-documents" });

      const navPunctuated = await dispatch({
        type: "navigate-track-sidebar",
        topicIndex: 99,
        topicTitle: "1.4 Notas recursos exemplos",
        topicSection: "1. Introdução",
      });

      const navDuplicate = await dispatch({
        type: "navigate-track-sidebar",
        topicIndex: 99,
        topicTitle: "9.1 Introdução",
        topicSection: "9. Modulo Evolutivo",
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
