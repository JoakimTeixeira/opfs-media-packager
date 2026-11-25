import { test, expect } from "../support/extension.ts";
import {
  contentScript,
  type RecordedCourseMessage,
  type MockChromeWindow,
} from "./support/playlist-page.ts";

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
