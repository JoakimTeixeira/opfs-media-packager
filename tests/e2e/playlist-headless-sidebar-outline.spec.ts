import { test, expect } from "./fixtures/extension.ts";
import {
  type RecordedCourseMessage,
  type MockChromeWindow,
  contentScript,
} from "./fixtures/playlist-headless-fixtures.ts";

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
