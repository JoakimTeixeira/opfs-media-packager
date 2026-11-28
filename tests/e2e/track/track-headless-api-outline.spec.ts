import { test, expect } from "../support/extension.ts";
import {
  type RecordedCourseMessage,
  type MockChromeWindow,
  contentScript,
} from "./support/track-page.ts";

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
            .find((msg) => msg?.type === "track-outline")?.outline?.items
            ?.length ?? 0,
        { timeout: 3000 },
      )
      .toBe(35);

    const outlineMsg = [...sentMessages]
      .reverse()
      .find((msg) => msg?.type === "track-outline");

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
