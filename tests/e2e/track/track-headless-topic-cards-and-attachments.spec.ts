import { syntheticOpaqueAssetUrl } from "../../../lib/materials/__fixtures__/attachment-tokens.ts";
import { test, expect } from "../support/extension.ts";
import {
  contentScript,
  type RecordedCourseMessage,
  type MockChromeWindow,
} from "./support/track-page.ts";

test("should extract localized topic and test sidebar cards, banner playlist title, embed iframe signal, and downloadable attachments", async ({
  sharedBrowser,
}) => {
  const page = await sharedBrowser.newPage();

  try {
    const sentMessages: RecordedCourseMessage[] = [];

    await page.exposeFunction(
      "__recordMessage",
      (message: RecordedCourseMessage) => sentMessages.push(message),
    );

    await page.route("https://training.example/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><head><title>Sample Course</title></head><body><div id='root'></div></body></html>",
      });
    });

    await page.goto(
      "https://training.example/c/sample-track/sections/700/lessons/2001",
    );

    const attachmentUrl = syntheticOpaqueAssetUrl("e2e-topic-card-deck");

    const extracted = await page.evaluate(
      async ({
        scriptSource,
        deckUrl,
      }: {
        readonly scriptSource: string;
        readonly deckUrl: string;
      }) => {
        const mockWindow = window as unknown as MockChromeWindow & {
          __documentListener?: (
            message: { type: string },
            sender: unknown,
            sendResponse: (response: unknown) => void,
          ) => void;
        };

        mockWindow.chrome = {
          runtime: {
            sendMessage(message: unknown) {
              mockWindow.__recordMessage?.(message);

              return Promise.resolve({ ok: true });
            },
            onMessage: {
              addListener(listener: unknown) {
                mockWindow.__documentListener =
                  listener as typeof mockWindow.__documentListener;
              },
            },
          },
        };

        const root = document.getElementById("root");

        if (root) {
          root.innerHTML = `
          <div role="banner">
            <button type="button" aria-label="Close sidebar"></button>
            <span>Sample Track</span>
            <button type="button">Complete topic</button>
          </div>
          <aside aria-label="Sidebar">
            <div>
              <div><span>Module One</span><span>2 tópicos</span></div>
              <div>
                <div class="bg-tertiary">
                  <img src="https://cdn.example/placeholder.png" alt="" />
                  <div><div>First Lesson</div><span>Tópico</span></div>
                </div>
                <div>
                  <button type="button">
                    <img src="https://cdn.example/placeholder.png" alt="" />
                    <div><div>Second Lesson</div><span>Tópico</span></div>
                  </button>
                </div>
              </div>
            </div>
            <div>
              <div><span>Module Two</span><span>1 tópico</span></div>
              <div>
                <div>
                  <button type="button">
                    <img src="https://cdn.example/placeholder.png" alt="" />
                    <div><div>Final Exam</div><span>Teste</span></div>
                  </button>
                </div>
              </div>
            </div>
          </aside>
          <main>
            <h2>First Lesson</h2>
            <iframe src="https://player.vimeo.com/video/900001001?app_id=990001"></iframe>
            <div data-testid="tip-tap-editor-content">
              <div class="tiptap ProseMirror"><p>Introductory notes.</p></div>
            </div>
            <div role="tabpanel">
              <div role="table">
                <div role="row">
                  <a href="${deckUrl}" download="">
                    <span><span class="truncate">Sample Deck.pptx</span></span>
                  </a>
                </div>
              </div>
            </div>
          </main>
        `;
        }

        (0, eval)(scriptSource);

        return new Promise((resolve) => {
          mockWindow.__documentListener?.(
            { type: "extract-topic-documents" },
            {},
            resolve,
          );
        });
      },
      { scriptSource: contentScript, deckUrl: attachmentUrl },
    );

    await expect
      .poll(
        () =>
          [...sentMessages]
            .reverse()
            .find((message) => message?.type === "track-outline")?.outline
            ?.items?.length ?? 0,
      )
      .toBe(3);

    const outline = [...sentMessages]
      .reverse()
      .find((message) => message?.type === "track-outline")?.outline;

    expect(outline?.title).toBe("Sample Track");

    expect(outline?.items.map((item) => item.fileTitle)).toEqual([
      "1.1 First Lesson",
      "1.2 Second Lesson",
      "2.1 Final Exam",
    ]);

    expect(outline?.items.map((item) => item.folderPath)).toEqual([
      ["(Track) Sample Track", "1. Module One"],
      ["(Track) Sample Track", "1. Module One"],
      ["(Track) Sample Track", "2. Module Two"],
    ]);

    const documentsResponse = extracted as {
      readonly documents?: {
        readonly markdown?: string;
        readonly files?: readonly {
          readonly kind: string;
          readonly filename: string;
          readonly url: string;
        }[];
      };
    };

    expect(documentsResponse?.documents?.markdown).toContain(
      "Introductory notes.",
    );

    expect(documentsResponse?.documents?.files).toEqual([
      {
        kind: "pptx",
        filename: "Sample Deck.pptx",
        url: attachmentUrl,
      },
    ]);
  } finally {
    await page.close();
  }
});
