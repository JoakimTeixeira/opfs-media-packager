import test from "node:test";
import assert from "node:assert/strict";
import type { ItemCompanionDocuments } from "../../lib/item-assets.ts";

const EXT_ID = "abcdefghijklmnopqrstuvwxzyabcdef";
const EXT_ORIGIN = `chrome-extension://${EXT_ID}/`;
const COURSE_ORIGIN = "https://training.example";

interface MockTab {
  readonly id: number;
  readonly url: string;
  readonly windowId?: number;
  readonly title: string;
}

interface MockTabCreateOptions {
  readonly url?: string;
  readonly windowId?: number;
  readonly title?: string;
  readonly active?: boolean;
}

interface CreatedTabRecord extends MockTabCreateOptions {
  readonly id: number;
  readonly url: string;
}

interface MockWindow {
  readonly id: number;
  readonly state: string;
  readonly tabs: readonly MockTab[];
}

interface MockWindowCreateOptions {
  readonly url?: string;
  readonly state?: string;
  readonly type?: string;
  readonly focused?: boolean;
}

interface CreatedWindowRecord extends MockWindowCreateOptions {
  readonly id: number;
  readonly tabId: number;
}

interface ExecuteScriptDetails {
  readonly target: {
    readonly tabId: number;
    readonly frameIds?: readonly number[];
  };
  readonly files?: readonly string[];
  readonly world?: string;
}

interface MessageSender {
  readonly id: string;
  readonly url?: string;
  readonly frameId?: number;
  readonly tab?: { readonly id: number };
}

interface TabMessageOptions {
  readonly frameId?: number;
}

interface RecordedTabMessage {
  readonly tabId: number;
  readonly message: Record<string, unknown>;
  readonly options: TabMessageOptions;
}

interface RecordedFetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

interface WebRequestDetails {
  readonly tabId: number;
  readonly frameId: number;
  readonly parentFrameId: number;
  readonly statusCode: number;
  readonly url: string;
}

interface ApiLesson {
  readonly id: string;
  readonly url: string;
  readonly fileTitle: string;
  readonly folderPath: readonly string[];
  readonly navigationIndex?: number;
}

interface ProbeLessonTarget {
  readonly itemIndex: number;
  readonly id?: string;
  readonly url?: string;
}

interface DiscoveredSubtitle {
  readonly url: string;
  readonly language: string;
  readonly label: string;
}

interface DiscoveredQualityOption {
  readonly url: string;
  readonly label: string;
}

interface DiscoveredLesson {
  readonly itemIndex: number;
  readonly title: string;
  readonly url: string;
  readonly kind?: string;
  readonly qualityOptions?: readonly DiscoveredQualityOption[];
  readonly subtitles: readonly DiscoveredSubtitle[];
  readonly primaryVideoTitle?: string;
  readonly extraVideos?: readonly {
    readonly title: string;
    readonly url: string;
    readonly kind?: string;
  }[];
  readonly documents?: ItemCompanionDocuments;
}

interface CourseScanRecord {
  readonly id: string;
  readonly status: string;
  readonly nextItemIndex?: number;
  readonly rateLimited?: boolean;
  readonly discovered: readonly DiscoveredLesson[];
}

interface CourseDownloadItem {
  readonly itemIndex: number;
}

interface CourseDownloadRecord {
  readonly sourceTabId?: number | null;
  readonly completedItemIndices?: readonly number[];
  readonly items: readonly CourseDownloadItem[];
}

interface RuntimeResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly scanId?: string;
  readonly scan?: CourseScanRecord;
  readonly playlistDownload?: CourseDownloadRecord;
}

type RuntimeMessageListener = (
  message: Record<string, unknown>,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined | void;

type WebRequestListener = (details: WebRequestDetails) => void;

type TabRemovedListener = (tabId: number) => void | Promise<void>;

type TabMessageHandler = (
  tabId: number,
  message: Record<string, unknown>,
  options: TabMessageOptions,
) => Promise<Record<string, unknown>>;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function probeLessons(
  message: Record<string, unknown>,
): readonly ProbeLessonTarget[] {
  return Array.isArray(message.items)
    ? (message.items as readonly ProbeLessonTarget[])
    : [];
}

function stringField(message: Record<string, unknown>, key: string): string {
  const value = message[key];

  return typeof value === "string" ? value : "";
}

function createHarness() {
  const sessionStore = new Map<string, unknown>();
  const tabs = new Map<number, MockTab>();
  const windows = new Map<number, MockWindow>();
  const messageListeners: RuntimeMessageListener[] = [];
  const webRequestListeners: WebRequestListener[] = [];
  const tabRemovedListeners: TabRemovedListener[] = [];

  const calls = {
    tabsCreated: [] as CreatedTabRecord[],
    windowsCreated: [] as CreatedWindowRecord[],
    scriptingExecuted: [] as ExecuteScriptDetails[],
    tabMessages: [] as RecordedTabMessage[],
    dnrRemoved: [] as number[],
    dnrAdded: [] as Record<string, unknown>[],
    fetchCalls: [] as RecordedFetchCall[],
  };

  const harnessState: {
    nextTabId: number;
    nextWindowId: number;
    tabMessageHandler: TabMessageHandler;
    fetchHandler: FetchHandler;
  } = {
    nextTabId: 100,
    nextWindowId: 200,
    tabMessageHandler: async () => ({ ok: true }),
    fetchHandler: async () =>
      new Response("#EXTM3U\n#EXT-X-TARGETDURATION:4\nseg.ts\n", {
        status: 200,
      }),
  };

  const chromeMock = {
    runtime: {
      id: EXT_ID,
      getURL(path = ""): string {
        return `${EXT_ORIGIN}${path}`;
      },
      onMessage: {
        addListener(fn: RuntimeMessageListener): void {
          messageListeners.push(fn);
        },
      },
    },
    storage: {
      session: {
        async get(
          keys?: string | readonly string[] | null,
        ): Promise<Record<string, unknown>> {
          if (typeof keys === "string") {
            return sessionStore.has(keys)
              ? { [keys]: sessionStore.get(keys) }
              : {};
          }

          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};

            for (const key of keys) {
              if (sessionStore.has(key)) out[key] = sessionStore.get(key);
            }

            return out;
          }

          return Object.fromEntries(sessionStore.entries());
        },
        async set(values: Record<string, unknown>): Promise<void> {
          for (const [key, value] of Object.entries(values)) {
            sessionStore.set(key, value);
          }
        },
        async remove(keys: string | readonly string[]): Promise<void> {
          const list = Array.isArray(keys) ? keys : [keys];

          for (const key of list) sessionStore.delete(key);
        },
      },
    },
    tabs: {
      async get(tabId: number): Promise<MockTab> {
        const tab = tabs.get(tabId);

        if (!tab) throw new Error("Tab not found");

        return { ...tab };
      },
      async create(opts: MockTabCreateOptions): Promise<MockTab> {
        const id = harnessState.nextTabId++;

        const tab: MockTab = {
          id,
          url: opts.url || "",
          windowId: opts.windowId ?? 1,
          title: opts.title || "",
        };

        tabs.set(id, tab);
        calls.tabsCreated.push({ ...opts, id, url: tab.url });

        return { ...tab };
      },
      async update(tabId: number, props: Partial<MockTab>): Promise<MockTab> {
        const current: MockTab = tabs.get(tabId) ?? {
          id: tabId,
          url: "",
          title: "",
        };

        const updated: MockTab = { ...current, ...props };

        tabs.set(tabId, updated);

        return { ...updated };
      },
      async remove(tabId: number): Promise<void> {
        tabs.delete(tabId);
        for (const fn of tabRemovedListeners) await fn(tabId);
      },
      async sendMessage(
        tabId: number,
        message: Record<string, unknown>,
        options: TabMessageOptions = {},
      ): Promise<Record<string, unknown>> {
        calls.tabMessages.push({ tabId, message, options });

        return harnessState.tabMessageHandler(tabId, message, options);
      },
      onUpdated: {
        addListener(): void {},
      },
      onRemoved: {
        addListener(fn: TabRemovedListener): void {
          tabRemovedListeners.push(fn);
        },
      },
    },
    windows: {
      async create(opts: MockWindowCreateOptions): Promise<MockWindow> {
        if (opts.state === "minimized" && "focused" in opts) {
          throw new Error(
            "Invalid value for argument 1. Property 'focused': Minimized windows cannot set focused.",
          );
        }

        const winId = harnessState.nextWindowId++;
        const tabId = harnessState.nextTabId++;

        const tab: MockTab = {
          id: tabId,
          url: opts.url || "",
          windowId: winId,
          title: "",
        };

        tabs.set(tabId, tab);

        const win: MockWindow = {
          id: winId,
          state: opts.state || "normal",
          tabs: [tab],
        };

        windows.set(winId, win);
        calls.windowsCreated.push({ ...opts, id: winId, tabId });

        return win;
      },
      async remove(winId: number): Promise<void> {
        const win = windows.get(winId);

        windows.delete(winId);

        if (win?.tabs) {
          for (const t of win.tabs) tabs.delete(t.id);
        }
      },
    },
    scripting: {
      async executeScript(
        details: ExecuteScriptDetails,
      ): Promise<readonly { readonly result: boolean }[]> {
        calls.scriptingExecuted.push(details);

        return [{ result: true }];
      },
    },
    alarms: {
      async create(): Promise<void> {},
      async clear(): Promise<void> {},
      onAlarm: {
        addListener(): void {},
      },
    },
    declarativeNetRequest: {
      async updateSessionRules({
        removeRuleIds = [],
        addRules = [],
      }: {
        readonly removeRuleIds?: readonly number[];
        readonly addRules?: readonly Record<string, unknown>[];
      }): Promise<void> {
        for (const id of removeRuleIds) calls.dnrRemoved.push(id);
        for (const rule of addRules) calls.dnrAdded.push(rule);
      },
    },
    webRequest: {
      onCompleted: {
        addListener(fn: WebRequestListener): void {
          webRequestListeners.push(fn);
        },
      },
    },
    action: {
      async setBadgeText(): Promise<void> {},
      async setBadgeBackgroundColor(): Promise<void> {},
    },
    downloads: {
      onDeterminingFilename: {
        addListener(): void {},
      },
    },
  };

  function sendRuntimeMessage(
    message: Record<string, unknown>,
    sender: MessageSender,
  ): Promise<RuntimeResponse | undefined> {
    return new Promise((resolve) => {
      const state = { responded: false };

      const sendResponse = (value?: unknown): void => {
        state.responded = true;
        resolve(value as RuntimeResponse | undefined);
      };

      for (const listener of messageListeners) {
        const keepOpen = listener(message, sender, sendResponse);

        if (state.responded || keepOpen) return;
      }

      resolve(undefined);
    });
  }

  function emitWebRequest(details: WebRequestDetails): void {
    for (const listener of webRequestListeners) listener(details);
  }

  function reset(): void {
    sessionStore.clear();
    tabs.clear();
    windows.clear();
    calls.tabsCreated.length = 0;
    calls.windowsCreated.length = 0;
    calls.scriptingExecuted.length = 0;
    calls.tabMessages.length = 0;
    calls.dnrRemoved.length = 0;
    calls.dnrAdded.length = 0;
    calls.fetchCalls.length = 0;
    harnessState.tabMessageHandler = async () => ({ ok: true });
  }

  return {
    chromeMock,
    sessionStore,
    tabs,
    calls,
    sendRuntimeMessage,
    emitWebRequest,
    reset,
    setTabMessageHandler(fn: TabMessageHandler): void {
      harnessState.tabMessageHandler = fn;
    },
    setFetchHandler(fn: FetchHandler): void {
      harnessState.fetchHandler = fn;
    },
    async mockFetch(
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> {
      calls.fetchCalls.push({ url: String(url), init });

      return harnessState.fetchHandler(String(url), init);
    },
  };
}

const realSetTimeout = globalThis.setTimeout;

globalThis.setTimeout = ((
  fn: (...args: unknown[]) => void,
  ms = 0,
  ...args: unknown[]
) =>
  realSetTimeout(
    fn,
    ms > 20 ? Math.min(15, Math.ceil(ms / 40)) : ms,
    ...args,
  )) as unknown as typeof globalThis.setTimeout;

const harness = createHarness();

globalThis.chrome = harness.chromeMock as unknown as typeof chrome;

globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
  harness.mockFetch(url, init)) as unknown as typeof fetch;

await import("../../background.ts");

const extSender: MessageSender = Object.freeze({
  id: EXT_ID,
  url: `${EXT_ORIGIN}popup.html`,
  frameId: 0,
});

function makeApiLessons(count: number): ApiLesson[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(7465 + index),
    url: `${COURSE_ORIGIN}/courses/uuid-1/177/168/${136 + Math.floor(index / 7)}/conteudos?capitulo=${136 + Math.floor(index / 7)}&conteudo=${7465 + index}`,
    fileTitle: `1.${index + 1} Lesson ${index + 1}`,
    folderPath: ["Playlist", "Chapter 1"],
  }));
}

async function waitForScanReady(
  scanId: string,
  timeoutMs = 4000,
): Promise<CourseScanRecord | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await harness.sendRuntimeMessage(
      { type: "get-playlist-scan", scanId },
      extSender,
    );

    if (res?.scan?.status === "ready") return res.scan;
    await new Promise<void>((r) => setTimeout(r, 25));
  }

  const latest = await harness.sendRuntimeMessage(
    { type: "get-playlist-scan", scanId },
    extSender,
  );

  return latest?.scan;
}

test("Tier 1 headless scan resolves all 35 lessons with 0 tabs/windows, retries CORS omit for subtitles, and maps generic Subtitle to language", async () => {
  harness.reset();
  const sourceTabId = 10;
  const lessons = makeApiLessons(35);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(async (url, init) => {
    if (url.endsWith("playlist.m3u8")) {
      return new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480\n480p/video.m3u8\n",
        { status: 200 },
      );
    }

    if (url.endsWith(".vtt")) {
      // Simulate wildcard-ACAO CDN rejecting credentials:"include" and succeeding on "omit".
      if (init?.credentials === "include") {
        throw new TypeError("Failed to fetch");
      }

      return new Response(
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVocê não precisa escolher agora, porque vamos ver tudo.\n",
        { status: 200 },
      );
    }

    return new Response("", { status: 404 });
  });

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        const frameSender: MessageSender = {
          id: EXT_ID,
          tab: { id: tabId },
          frameId: 0,
          url: lessons[0].url,
        };

        const requestId = stringField(message, "requestId");

        for (const item of probeLessons(message)) {
          await harness.sendRuntimeMessage(
            {
              type: "playlist-item-probed",
              requestId,
              itemIndex: item.itemIndex,
              stream: {
                url: "",
                mediaUrl: `https://media.example.net/v-${item.itemIndex}/playlist.m3u8`,
                subtitles: [
                  {
                    url: `https://media.example.net/v-${item.itemIndex}/subs.vtt`,
                    label: "Subtitle",
                    language: "Subtitle",
                  },
                ],
              },
            },
            frameSender,
          );
        }

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [],
            unresolvedLinks: {},
          },
          frameSender,
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "35 Lesson Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 35);
  assert.equal(scan.discovered[0].subtitles[0].language, "Portuguese");
  assert.notEqual(scan.discovered[0].subtitles[0].language, "Subtitle");
  assert.equal(harness.calls.windowsCreated.length, 0);
  // Only playlist.html tab was opened; zero lesson tabs!
  assert.equal(harness.calls.tabsCreated.length, 1);
  assert.match(harness.calls.tabsCreated[0].url, /playlist\.html\?scan=/);
});

test("Injects page-course-probe.js via chrome.scripting when Tier 1 reports probe-not-ready", async () => {
  harness.reset();
  const sourceTabId = 11;
  const lessons = makeApiLessons(3);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const probeState = { attempts: 0 };

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type !== "probe-playlist-items") return { ok: true };
    probeState.attempts += 1;

    if (probeState.attempts === 1) {
      return { ok: false, reason: "probe-not-ready" };
    }

    queueMicrotask(async () => {
      const sender: MessageSender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: 0,
        url: lessons[0].url,
      };

      const requestId = stringField(message, "requestId");

      for (const item of probeLessons(message)) {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: item.itemIndex,
            stream: {
              mediaUrl: `https://media.example.net/retry-${item.itemIndex}/playlist.m3u8`,
              subtitles: [],
            },
          },
          sender,
        );
      }

      await harness.sendRuntimeMessage(
        {
          type: "playlist-items-probe-done",
          requestId,
          unresolvedIndices: [],
          unresolvedLinks: {},
        },
        sender,
      );
    });

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Inject Test", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 3);
  assert.equal(harness.calls.scriptingExecuted.length, 1);

  assert.deepEqual(harness.calls.scriptingExecuted[0], {
    target: { tabId: sourceTabId },
    files: ["dist/page-playlist-probe.js"],
    world: "MAIN",
  });

  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);
});

test("Tier 1.5 invisible same-origin iframe captures nested player iframe via parentFrameId without polluting main tab, then escalates remaining 34 lessons", async () => {
  harness.reset();
  const sourceTabId = 12;
  const lessons = makeApiLessons(35);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const iframeState = { closedProbeId: "" };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (
      message.type === "probe-playlist-items" &&
      (options.frameId ?? 0) === 0
    ) {
      // Main tab has not captured the API template yet: return all 35 unresolved.
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          { id: EXT_ID, tab: { id: tabId }, frameId: 0, url: lessons[0].url },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const hiddenFrameId = 42;

      queueMicrotask(async () => {
        // Hidden iframe signals ready at document_start -> observer arms synchronously!
        await harness.sendRuntimeMessage(
          {
            type: "hidden-probe-frame-ready",
            probeId: stringField(message, "probeId"),
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: hiddenFrameId,
            url: stringField(message, "url"),
          },
        );

        // Nested video player iframe (frameId 99, parentFrameId 42) loads .m3u8!
        harness.emitWebRequest({
          tabId,
          frameId: 99,
          parentFrameId: hiddenFrameId,
          statusCode: 200,
          url: "https://media.example.net/lesson-0/playlist.m3u8",
        });
      });

      return { ok: true };
    }

    if (message.type === "probe-playlist-items" && options.frameId === 42) {
      // Escalated parallel fetch inside hidden iframe resolves lessons 1..34!
      queueMicrotask(async () => {
        const frameSender: MessageSender = {
          id: EXT_ID,
          tab: { id: tabId },
          frameId: 42,
          url: lessons[0].url,
        };

        const requestId = stringField(message, "requestId");

        for (const item of probeLessons(message)) {
          await harness.sendRuntimeMessage(
            {
              type: "playlist-item-probed",
              requestId,
              itemIndex: item.itemIndex,
              stream: {
                mediaUrl: `https://media.example.net/escalated-${item.itemIndex}/playlist.m3u8`,
                subtitles: [],
              },
            },
            frameSender,
          );
        }

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [],
            unresolvedLinks: {},
          },
          frameSender,
        );
      });

      return { ok: true };
    }

    if (message.type === "close-hidden-probe-frame") {
      iframeState.closedProbeId = stringField(message, "probeId");

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Tier 1.5 Escalation Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 35);

  assert.ok(
    iframeState.closedProbeId,
    "Hidden probe iframe should be closed after scan",
  );

  // Zero new windows and zero lesson tabs opened!
  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);

  // Main tab popup detections were NOT polluted by the hidden iframe!
  assert.equal(
    harness.sessionStore.get(`detections:${sourceTabId}`),
    undefined,
  );
});

test("Tier 1.5 steps invisibly through sidebar lessons, skips seeded stream on firstRun, probes linked video in temp sibling iframe, and keeps sidebar intact", async () => {
  harness.reset();
  const sourceTabId = 13;
  const playlistUrl = `${COURSE_ORIGIN}/c/engineering/sections/1/lessons/10`;
  const linkedPostUrl = `${COURSE_ORIGIN}/c/posts/live-session`;
  const activeStreamUrl = "https://media.example.net/active-0/playlist.m3u8";

  const lessons: readonly ApiLesson[] = [
    {
      id: "current-item",
      url: playlistUrl,
      fileTitle: "1.1 Active Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: -1,
    },
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.2 Intro",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "1.3 Linked Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 1,
    },
    {
      id: "btn-2",
      url: playlistUrl,
      fileTitle: "1.4 After Linked",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 2,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Playlist",
  });

  // Seed lesson 0 as already detected in the active tab.
  await harness.chromeMock.storage.session.set({
    [`detections:${sourceTabId}`]: {
      pageUrl: playlistUrl,
      streams: [
        {
          key: "https://media.example.net/active-0/",
          url: activeStreamUrl,
          host: "media.example.net",
          title: "1.1 Active Lesson",
          sourceUrl: playlistUrl,
          kind: "master",
          qualityOptions: [
            {
              url: "https://media.example.net/active-0/720p/video.m3u8",
              label: "720p",
            },
          ],
          subtitles: [
            {
              url: "https://media.example.net/active-0/pt.vtt",
              label: "Portuguese",
              language: "Portuguese",
            },
          ],
          detectedAt: Date.now(),
        },
      ],
      subtitles: [],
    },
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const probeEvents = {
    navigatedPrimaryFrameAway: false,
    openedSiblingFrame: false,
    closedSiblingProbeId: "",
  };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: { 2: linkedPostUrl },
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: options.frameId ?? 0,
            url: playlistUrl,
          },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const isLinked = targetUrl === linkedPostUrl;
      const frameId = isLinked ? 56 : 55;

      if (isLinked) probeEvents.openedSiblingFrame = true;

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (!isLinked) {
          // Initial course page auto-loads active lesson 0 BEFORE sidebar click!
          harness.emitWebRequest({
            tabId,
            frameId: 55,
            parentFrameId: 0,
            statusCode: 200,
            url: activeStreamUrl,
          });
        }

        if (isLinked) {
          harness.emitWebRequest({
            tabId,
            frameId: 56,
            parentFrameId: 0,
            statusCode: 200,
            url: "https://media.example.net/linked-2/playlist.m3u8",
          });
        }
      });

      return { ok: true };
    }

    if (message.type === "close-hidden-probe-frame") {
      probeEvents.closedSiblingProbeId = stringField(message, "probeId");

      return { ok: true };
    }

    if (message.type === "navigate-hidden-probe-frame") {
      probeEvents.navigatedPrimaryFrameAway = true;

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === 55
    ) {
      const navIndex = message.itemIndex;

      queueMicrotask(() => {
        harness.emitWebRequest({
          tabId,
          frameId: 55,
          parentFrameId: 0,
          statusCode: 200,
          url: `https://media.example.net/sidebar-${String(navIndex)}/playlist.m3u8`,
        });
      });

      return { ok: true };
    }

    if (message.type === "get-page-heading" && options.frameId === 56) {
      return { title: "Live Architecture Review" };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sidebar Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 5000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 4);
  assert.equal(probeEvents.navigatedPrimaryFrameAway, false);
  assert.equal(probeEvents.openedSiblingFrame, true);
  assert.ok(probeEvents.closedSiblingProbeId);

  const firstStepped = scan.discovered.find((item) => item.itemIndex === 1);
  const linked = scan.discovered.find((item) => item.itemIndex === 2);
  const afterLinked = scan.discovered.find((item) => item.itemIndex === 3);

  assert.equal(
    firstStepped?.url,
    "https://media.example.net/sidebar-0/playlist.m3u8",
  );

  assert.equal(linked?.title, "1.3 Live Architecture Review");

  assert.equal(
    afterLinked?.url,
    "https://media.example.net/sidebar-2/playlist.m3u8",
  );

  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);
});

test("Tier 2 fallback opens minimized popup WITHOUT focused property and NEVER falls back to main-window chrome.tabs.create", async () => {
  harness.reset();
  const sourceTabId = 14;
  const lessons = makeApiLessons(2);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          { id: EXT_ID, tab: { id: tabId }, frameId: 0, url: lessons[0].url },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      // Simulate framing blocked -> falls back to Tier 2 minimized popup
      return { ok: false };
    }

    return { ok: true };
  });

  await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Framing Blocked Course", items: lessons },
    },
    extSender,
  );

  // Give async Tier 1 -> Tier 1.5 -> Tier 2 transition a tick to run
  await new Promise<void>((r) => setTimeout(r, 120));
  assert.equal(harness.calls.windowsCreated.length, 1);
  assert.equal(harness.calls.windowsCreated[0].state, "minimized");
  assert.equal(harness.calls.windowsCreated[0].type, "popup");
  assert.equal("focused" in harness.calls.windowsCreated[0], false);
  // Only playlist.html was created via chrome.tabs.create — zero lesson tabs in main window!
  assert.equal(harness.calls.tabsCreated.length, 1);
  assert.match(harness.calls.tabsCreated[0].url, /playlist\.html\?scan=/);
});

test("Stops immediately on rateLimited:true without escalating to Tier 1.5 hidden iframes or Tier 2 popup windows", async () => {
  harness.reset();
  const sourceTabId = 15;
  const lessons = makeApiLessons(10);

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lessons[0].url,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n",
        { status: 200 },
      ),
  );

  const escalation = { hiddenIframeRequested: false };

  harness.setTabMessageHandler(async (tabId, message) => {
    if (message.type === "open-hidden-probe-frame") {
      escalation.hiddenIframeRequested = true;

      return { ok: true };
    }

    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        const sender: MessageSender = {
          id: EXT_ID,
          tab: { id: tabId },
          frameId: 0,
          url: lessons[0].url,
        };

        const requestId = stringField(message, "requestId");

        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            stream: {
              mediaUrl: "https://media.example.net/partial-0/playlist.m3u8",
              subtitles: [],
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            unresolvedLinks: {},
            rateLimited: true,
          },
          sender,
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Rate Limited Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.rateLimited, true);
  assert.equal(scan.discovered.length, 1);
  assert.equal(escalation.hiddenIframeRequested, false);
  assert.equal(harness.calls.windowsCreated.length, 0);
  assert.equal(harness.calls.tabsCreated.length, 1);
});

test("open-course-download filters discovered lessons by selectedItemIndices in course order and rejects empty selection", async () => {
  harness.reset();
  const scanId = "scan-selection-test";

  await harness.chromeMock.storage.session.set({
    [`playlist-scan:${scanId}`]: {
      id: scanId,
      title: "Selection Test",
      lessons: makeApiLessons(3),
      discovered: [
        {
          itemIndex: 2,
          title: "1.3 Third",
          url: "https://media.example.net/3/playlist.m3u8",
        },
        {
          itemIndex: 0,
          title: "1.1 First",
          url: "https://media.example.net/1/playlist.m3u8",
        },
        {
          itemIndex: 1,
          title: "1.2 Second",
          url: "https://media.example.net/2/playlist.m3u8",
        },
      ],
      status: "ready",
    },
  });

  const emptyResult = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, selectedItemIndices: [] },
    extSender,
  );

  assert.match(emptyResult?.error ?? "", /Select at least one item/);

  const okResult = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, selectedItemIndices: [2, 0] },
    extSender,
  );

  assert.equal(okResult?.ok, true);
  const createdUrl = harness.calls.tabsCreated[0].url;
  const playlistDownloadId = new URL(createdUrl).searchParams.get("playlist");

  const taken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId },
    extSender,
  );

  assert.deepEqual(
    taken?.playlistDownload?.items.map((item) => item.itemIndex),
    [0, 2],
  );

  // Completing Lesson 0 persists in session storage so a page reload can
  // resume from Lesson 2 instead of failing with "Course download unavailable".
  const completed = await harness.sendRuntimeMessage(
    {
      type: "complete-playlist-download-item",
      playlistDownloadId,
      itemIndex: 0,
    },
    extSender,
  );

  assert.equal(completed?.ok, true);

  const takenAfterReload = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId },
    extSender,
  );

  assert.deepEqual(
    takenAfterReload?.playlistDownload?.completedItemIndices,
    [0],
  );

  assert.deepEqual(
    takenAfterReload?.playlistDownload?.items.map((item) => item.itemIndex),
    [0, 2],
  );

  // Per-lesson CDN authorization updates DNR rule 910001 for Lesson 2's directory.
  const authorized = await harness.sendRuntimeMessage(
    {
      type: "authorize-download-media",
      url: "https://media.example.net/3/720p/video.m3u8",
      sourceUrl: "https://training.example/c/ai/sections/10/lessons/103",
    },
    extSender,
  );

  assert.equal(authorized?.ok, true);
  assert.ok(harness.calls.dnrAdded.length >= 1);

  const latestRule = harness.calls.dnrAdded.at(-1) as
    { condition?: { urlFilter?: string } } | undefined;

  assert.equal(latestRule?.condition?.urlFilter, "||media.example.net/3/*");
});

test("open-course-download includes materials-only and subtitle-only lessons in default all mode", async () => {
  harness.reset();
  const scanId = "scan-mixed-subsets";

  await harness.chromeMock.storage.session.set({
    [`playlist-scan:${scanId}`]: {
      id: scanId,
      title: "Mixed Content",
      lessons: makeApiLessons(3),
      discovered: [
        {
          itemIndex: 0,
          title: "1.1 Material Only",
          url: "",
          documents: {
            markdown: "# Notes\n",
            images: [],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
        {
          itemIndex: 1,
          title: "1.2 Subtitle Only",
          url: "",
          subtitles: [
            {
              url: "https://media.example.net/1/pt.vtt",
              language: "Portuguese",
              label: "Portuguese",
            },
          ],
        },
        {
          itemIndex: 2,
          title: "1.3 Empty",
          url: "",
          documents: {
            markdown: "",
            images: [],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        },
      ],
      status: "ready",
    },
  });

  const videosRes = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, playlistDownloadMode: "videos" },
    extSender,
  );

  assert.equal(videosRes?.ok, true);

  const videosId = new URL(harness.calls.tabsCreated[0].url).searchParams.get(
    "playlist",
  );

  const videosTaken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId: videosId },
    extSender,
  );

  assert.deepEqual(
    videosTaken?.playlistDownload?.items.map((item) => item.itemIndex),
    [1],
  );

  const materialsRes = await harness.sendRuntimeMessage(
    {
      type: "open-playlist-download",
      scanId,
      playlistDownloadMode: "documents",
    },
    extSender,
  );

  assert.equal(materialsRes?.ok, true);

  const materialsId = new URL(
    harness.calls.tabsCreated[1].url,
  ).searchParams.get("playlist");

  const materialsTaken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId: materialsId },
    extSender,
  );

  assert.deepEqual(
    materialsTaken?.playlistDownload?.items.map((item) => item.itemIndex),
    [0],
  );

  const allRes = await harness.sendRuntimeMessage(
    { type: "open-playlist-download", scanId, playlistDownloadMode: "all" },
    extSender,
  );

  assert.equal(allRes?.ok, true);

  const allId = new URL(harness.calls.tabsCreated[2].url).searchParams.get(
    "playlist",
  );

  const allTaken = await harness.sendRuntimeMessage(
    { type: "take-playlist-download", playlistDownloadId: allId },
    extSender,
  );

  assert.deepEqual(
    allTaken?.playlistDownload?.items.map((item) => item.itemIndex),
    [0, 1],
  );
});

test("list-detections recovers eager page transcript VTTs, ignores storyboard mosaic.vtt, and avoids race overwrites with recordPlaylist", async () => {
  harness.reset();
  const tabId = 42;
  const lessonUrl = "https://training.example/c/ai/sections/98/lessons/3727";
  const playlistUrl = "https://media.example.net/video-42/hls/playlist.m3u8";
  const mosaicUrl = "https://media.example.net/video-42/mosaic.vtt";

  const transcriptUrl =
    "https://training.example/media_transcripts/3824457.vtt";

  harness.tabs.set(tabId, {
    id: tabId,
    url: lessonUrl,
    title: "Curso Desenvolvimento com IA",
  });

  // Seed a prior lesson URL so SPA navigation synchronization is exercised.
  await harness.chromeMock.storage.session.set({
    [`detections:${tabId}`]: {
      pageUrl: "https://training.example/c/ai/sections/98/lessons/3726",
      streams: [],
      subtitles: [],
    },
  });

  harness.setFetchHandler(async (input) => {
    const url = String(input);

    if (url === playlistUrl) {
      return new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n",
        { status: 200 },
      );
    }

    if (url === mosaicUrl) {
      return new Response(
        "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nmosaic.jpg#xywh=0,0,160,90\n",
        { status: 200 },
      );
    }

    if (url === transcriptUrl) {
      return new Response(
        "WEBVTT\n\n00:00:00.080 --> 00:00:02.240\nOlá pessoal, você está vendo esta aula sobre desenvolvimento com IA.\n",
        { status: 200 },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  harness.setTabMessageHandler(async (_id, message) => {
    if (message.type === "collect-page-subtitles") {
      return {
        tracks: [
          { url: mosaicUrl, language: "Subtitle", label: "thumbnails" },
          { url: transcriptUrl, language: "Subtitle", label: "" },
        ],
      };
    }

    return { ok: true };
  });

  // Fire playlist + mosaic + transcript concurrently on the new lesson URL.
  harness.emitWebRequest({
    tabId,
    frameId: 0,
    parentFrameId: -1,
    statusCode: 200,
    url: mosaicUrl,
  });

  harness.emitWebRequest({
    tabId,
    frameId: 0,
    parentFrameId: -1,
    statusCode: 200,
    url: playlistUrl,
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 60));

  const listed = (await harness.sendRuntimeMessage(
    { type: "list-detections", tabId },
    extSender,
  )) as {
    readonly streams?: readonly { readonly url: string }[];
    readonly subtitles?: readonly {
      readonly url: string;
      readonly language: string;
    }[];
  };

  assert.equal(listed?.streams?.length, 1);
  assert.equal(listed?.subtitles?.length, 1);
  assert.equal(listed?.subtitles?.[0]?.url, transcriptUrl);
  assert.equal(listed?.subtitles?.[0]?.language, "Portuguese");
});

test("Tier 1.5 preserves all 3 quality options across wildcard-CORS credentials:omit retry and trailing rendition playlist", async () => {
  harness.reset();
  const sourceTabId = 43;
  const playlistUrl = `${COURSE_ORIGIN}/c/ai/sections/1/lessons/10`;
  const masterUrl = "https://cdn.example.net/video-99/master.m3u8";
  const renditionUrl = "https://cdn.example.net/video-99/rendition-0.m3u8";
  const transcriptUrl = `${COURSE_ORIGIN}/media_transcripts/99.vtt`;

  const lessons: readonly ApiLesson[] = [
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.1 Fundamentos",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 0,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Playlist",
  });

  const fetchOrder: string[] = [];

  // Wildcard-ACAO CDN rejects credentials:"include" with TypeError and succeeds with credentials:"omit".
  harness.setFetchHandler(async (input, init) => {
    const url = String(input);

    if (init?.credentials === "include") {
      throw new TypeError("Failed to fetch");
    }

    if (url === masterUrl) {
      fetchOrder.push("master");

      // Trigger the trailing rendition ONLY after master has been fetched so
      // onStream(master) deterministically runs before onStream(rendition).
      realSetTimeout(() => {
        harness.emitWebRequest({
          tabId: sourceTabId,
          frameId: 77,
          parentFrameId: 0,
          statusCode: 200,
          url: renditionUrl,
        });
      }, 4);

      return new Response(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
          "rendition-1080.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720",
          "rendition-720.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
          "rendition-480.m3u8",
        ].join("\n"),
        { status: 200 },
      );
    }

    if (url === renditionUrl) {
      fetchOrder.push("rendition");

      return new Response(
        "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg0.ts\n#EXT-X-ENDLIST\n",
        { status: 200 },
      );
    }

    if (url === transcriptUrl) {
      return new Response(
        "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOlá pessoal, você está vendo esta aula sobre desenvolvimento com IA.\n",
        { status: 200 },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: options.frameId ?? 0,
            url: playlistUrl,
          },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "hidden-probe-frame-ready",
            probeId: stringField(message, "probeId"),
          },
          { id: EXT_ID, tab: { id: tabId }, frameId: 77, url: playlistUrl },
        );
      });

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === 77
    ) {
      queueMicrotask(() => {
        harness.emitWebRequest({
          tabId,
          frameId: 77,
          parentFrameId: 0,
          statusCode: 200,
          url: masterUrl,
        });
      });

      return { ok: true };
    }

    if (message.type === "collect-page-subtitles" && options.frameId === 77) {
      return {
        tracks: [{ url: transcriptUrl, language: "Subtitle", label: "" }],
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Wildcard CORS Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 5000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 1);
  assert.deepEqual(fetchOrder, ["master", "rendition"]);

  const discovered = scan.discovered[0];

  assert.equal(discovered.url, masterUrl);
  assert.equal(discovered.kind, "master");

  assert.deepEqual(
    discovered.qualityOptions?.map((option) => option.label),
    ["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"],
  );

  assert.equal(discovered.subtitles[0]?.language, "Portuguese");
});

test("list-detections recovers empty quality options via course page fallback and course-outline never downgrades 21 lessons to 2", async () => {
  harness.reset();
  const tabId = 44;
  const playlistUrl = `${COURSE_ORIGIN}/c/ai/sections/98/lessons/3727`;
  const manifestUrl = "https://cdn.example.net/asset-44/hls/playlist.m3u8";

  harness.tabs.set(tabId, {
    id: tabId,
    url: playlistUrl,
    title: "IA First Dev",
  });

  // Seed a stream whose initial inspection failed and left 0 quality options.
  await harness.chromeMock.storage.session.set({
    [`detections:${tabId}`]: {
      pageUrl: playlistUrl,
      streams: [
        {
          key: "https://cdn.example.net/asset-44/hls/",
          url: manifestUrl,
          host: "cdn.example.net",
          title: "Introdução ao Curso de Exemplo",
          sourceUrl: playlistUrl,
          kind: "media",
          qualityOptions: [],
          subtitles: [],
          detectedAt: Date.now(),
        },
      ],
      subtitles: [],
    },
  });

  // Service worker fetches fail (e.g. strict CDN rejecting extension origin), so page fallback must succeed.
  harness.setFetchHandler(
    async () => new Response("Forbidden", { status: 403 }),
  );

  harness.setTabMessageHandler(async (id, message) => {
    if (message.type === "fetch-media-from-page") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "page-media-result",
            requestId: stringField(message, "requestId"),
            response: {
              status: 200,
              body: [
                "#EXTM3U",
                "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
                "1080p/video.m3u8",
                "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
                "720p/video.m3u8",
                "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
                "480p/video.m3u8",
              ].join("\n"),
            },
          },
          { id: EXT_ID, tab: { id }, frameId: 0, url: playlistUrl },
        );
      });

      return { ok: true };
    }

    return { ok: true };
  });

  const pageSender: MessageSender = {
    id: EXT_ID,
    tab: { id: tabId },
    frameId: 0,
    url: playlistUrl,
  };

  // Publish full 21-lesson outline, then attempt to overwrite with a partial 2-lesson outline on the same URL.
  await harness.sendRuntimeMessage(
    {
      type: "playlist-outline",
      outline: {
        title: "IA First Dev",
        items: Array.from({ length: 21 }, (_, idx) => ({
          id: `sidebar-${idx}`,
          url: playlistUrl,
          fileTitle: `1.${idx + 1} Lesson ${idx + 1}`,
          folderPath: ["1. IA First Dev", "1. Module"],
          navigationIndex: idx === 0 ? -1 : idx - 1,
        })),
      },
    },
    pageSender,
  );

  await harness.sendRuntimeMessage(
    {
      type: "playlist-outline",
      outline: {
        title: "IA First Dev",
        items: Array.from({ length: 2 }, (_, idx) => ({
          id: `stray-${idx}`,
          url: `${COURSE_ORIGIN}/c/ai/sections/98/lessons/${idx + 1}`,
          fileTitle: `1.${idx + 1} Stray ${idx + 1}`,
          folderPath: ["1. IA First Dev", "1. Section"],
        })),
      },
    },
    pageSender,
  );

  const listed = (await harness.sendRuntimeMessage(
    { type: "list-detections", tabId },
    extSender,
  )) as {
    readonly streams?: readonly {
      readonly kind: string;
      readonly qualityOptions: readonly DiscoveredQualityOption[];
    }[];
    readonly playlistOutline?: { readonly items: readonly unknown[] };
  };

  assert.equal(listed?.playlistOutline?.items?.length, 21);
  assert.equal(listed?.streams?.[0]?.kind, "master");

  assert.deepEqual(
    listed?.streams?.[0]?.qualityOptions.map((option) => option.label),
    ["1080p (1920×1080)", "720p (1280×720)", "480p (854×480)"],
  );
});

test("Tier 1.5 discovers linked video via find-linked-video-in-page when Tier 1 provides no pre-known link and rejects forged hidden-probe-frame-ready senders", async () => {
  harness.reset();
  const sourceTabId = 45;
  const playlistUrl = `${COURSE_ORIGIN}/c/ai/sections/1/lessons/10`;
  const discoveredLinkedUrl = `${COURSE_ORIGIN}/c/posts/discovered-workshop`;

  const lessons: readonly ApiLesson[] = [
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.1 Regular Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "1.2 Link-Only Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 1,
    },
    {
      id: "btn-2",
      url: playlistUrl,
      fileTitle: "1.3 Final Lesson",
      folderPath: ["Playlist", "Module 1"],
      navigationIndex: 2,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Playlist",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const securityResults: {
    crossOrigin: RuntimeResponse | undefined;
    wrongTab: RuntimeResponse | undefined;
    topFrame: RuntimeResponse | undefined;
    unknownProbe: RuntimeResponse | undefined;
  } = {
    crossOrigin: undefined,
    wrongTab: undefined,
    topFrame: undefined,
    unknownProbe: undefined,
  };

  const state = {
    findLinkedCalls: 0,
    navigatedPrimaryAway: false,
    openedSibling: false,
  };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId: stringField(message, "requestId"),
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: options.frameId ?? 0,
            url: playlistUrl,
          },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const isLinked = targetUrl === discoveredLinkedUrl;
      const frameId = isLinked ? 88 : 87;

      if (isLinked) state.openedSibling = true;

      queueMicrotask(async () => {
        if (!isLinked) {
          // Probe negative security boundaries BEFORE sending the legitimate ready signal.
          securityResults.crossOrigin = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId },
            {
              id: EXT_ID,
              tab: { id: tabId },
              frameId: 99,
              url: "https://evil.example/c/ai/sections/1/lessons/10",
            },
          );

          securityResults.wrongTab = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId },
            {
              id: EXT_ID,
              tab: { id: tabId + 999 },
              frameId: 99,
              url: targetUrl,
            },
          );

          securityResults.topFrame = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId },
            { id: EXT_ID, tab: { id: tabId }, frameId: 0, url: targetUrl },
          );

          securityResults.unknownProbe = await harness.sendRuntimeMessage(
            { type: "hidden-probe-frame-ready", probeId: "forged-uuid" },
            { id: EXT_ID, tab: { id: tabId }, frameId: 99, url: targetUrl },
          );
        }

        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (isLinked) {
          harness.emitWebRequest({
            tabId,
            frameId: 88,
            parentFrameId: 0,
            statusCode: 200,
            url: "https://media.example.net/discovered-linked-1/playlist.m3u8",
          });
        }
      });

      return { ok: true };
    }

    if (message.type === "navigate-hidden-probe-frame") {
      state.navigatedPrimaryAway = true;

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === 87
    ) {
      const navIndex = message.itemIndex;

      if (navIndex === 0 || navIndex === 2) {
        queueMicrotask(() => {
          harness.emitWebRequest({
            tabId,
            frameId: 87,
            parentFrameId: 0,
            statusCode: 200,
            url: `https://media.example.net/lesson-${String(navIndex)}/playlist.m3u8`,
          });
        });
      }

      return { ok: true };
    }

    if (
      message.type === "find-linked-video-in-page" &&
      options.frameId === 87
    ) {
      state.findLinkedCalls += 1;

      return { ok: true, url: discoveredLinkedUrl };
    }

    if (message.type === "get-page-heading" && options.frameId === 88) {
      return { title: "Workshop Recording" };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Dynamic Linked Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 5000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(securityResults.crossOrigin?.ok, false);
  assert.equal(securityResults.wrongTab?.ok, false);
  assert.equal(securityResults.topFrame?.ok, false);
  assert.equal(securityResults.unknownProbe?.ok, false);
  assert.equal(state.findLinkedCalls, 1);
  assert.equal(state.openedSibling, true);
  assert.equal(state.navigatedPrimaryAway, false);
  assert.equal(scan.discovered.length, 3);

  const linked = scan.discovered.find((item) => item.itemIndex === 1);
  const finalLesson = scan.discovered.find((item) => item.itemIndex === 2);

  assert.equal(linked?.title, "1.2 Workshop Recording");

  assert.equal(
    finalLesson?.url,
    "https://media.example.net/lesson-2/playlist.m3u8",
  );
});

test("Tier 1.5 probes multiple linked posts sequentially, keeps parent Markdown & images intact, and appends distinct extraVideos and extraNotes", async () => {
  harness.reset();
  const sourceTabId = 46;
  const lesson0Url = `${COURSE_ORIGIN}/c/sample-course/sections/1/lessons/10`;
  const lesson1Url = `${COURSE_ORIGIN}/c/sample-course/sections/1/lessons/20`;
  const post1Url = `${COURSE_ORIGIN}/c/events/reading-group`;
  const post2Url = `${COURSE_ORIGIN}/c/community/sample-lesson`;
  const post3Url = `${COURSE_ORIGIN}/c/notes/pattern-notes`;

  const lessons: readonly ApiLesson[] = [
    {
      id: "10",
      url: lesson0Url,
      fileTitle: "1.1 YouTube Only Lesson",
      folderPath: ["(Playlist) Sample Track", "1. Module 1"],
    },
    {
      id: "20",
      url: lesson1Url,
      fileTitle: "1.2 Workflow Patterns",
      folderPath: ["(Playlist) Sample Track", "1. Module 1"],
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: lesson0Url,
    title: "Sample Track",
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="pt-BR",NAME="Portuguese",URI="pt.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/video.m3u8\n',
        { status: 200 },
      ),
  );

  const openedFrameUrls: string[] = [];

  const frameMaterialsById = new Map<number, Record<string, unknown>>([
    [
      91,
      {
        markdown: "# Reading Group - Patterns\n\nLive session notes.\n",
        images: [],
        pdfs: [],
        diagrams: [
          {
            kind: "diagram",
            url: "https://app.excalidraw.com/l/room/patterns",
            title: "Patterns Diagram",
          },
        ],
        slides: [],
      },
    ],
    [
      92,
      {
        markdown:
          "# Sample Lesson Video\n\nRepo: https://github.com/org/sample-repo\n",
        images: [],
        pdfs: [],
        diagrams: [],
        slides: [],
      },
    ],
    [
      93,
      {
        markdown: "# Pattern Notes\n\nComparison table notes.\n",
        images: [
          {
            kind: "image",
            url: "https://assets.example.net/pattern-comparison.png",
            filename: "pattern-comparison.png",
          },
        ],
        pdfs: [],
        diagrams: [],
        slides: [],
      },
    ],
  ]);

  const headingsByFrameId = new Map<number, string>([
    [91, "Reading Group - Patterns"],
    [92, "Sample Lesson Video"],
    [93, "Pattern Notes"],
  ]);

  const playlistByUrl = new Map<string, { frameId: number; url: string }>([
    [
      post1Url,
      {
        frameId: 91,
        url: "https://media.example.net/pattern-group-1/playlist.m3u8",
      },
    ],
    [
      post2Url,
      {
        frameId: 92,
        url: "https://media.example.net/pattern-lesson-2/playlist.m3u8",
      },
    ],
  ]);

  const frameIdByUrl = new Map<string, number>([
    [post1Url, 91],
    [post2Url, 92],
    [post3Url, 93],
  ]);

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: lesson0Url,
      };

      queueMicrotask(async () => {
        // Lesson 0: YouTube lesson resolved completely in Tier 1.
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            stream: {
              url: "",
              mediaUrl: "",
              subtitles: [],
              sourceUrl: lesson0Url,
              documents: {
                markdown:
                  "# 1.1 YouTube Only Lesson\n\n**Vídeo:** [Talk](https://www.youtube.com/watch?v=vid11111111)\n",
                images: [],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        // Lesson 1: partial parent materials emitted BEFORE Tier 1.5 probes 3 linked posts.
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 1,
            partial: true,
            stream: {
              url: "",
              mediaUrl: "",
              subtitles: [],
              sourceUrl: lesson1Url,
              documents: {
                markdown: [
                  "# 1.2 Workflow Patterns",
                  "",
                  `[Reading Group](${post1Url})`,
                  "",
                  `[Sample Lesson](${post2Url})`,
                  "",
                  `[Pattern Notes](${post3Url})`,
                  "",
                ].join("\n"),
                images: [
                  {
                    kind: "image",
                    url: "https://assets.example.net/parent-img-1.png",
                    filename: "parent-img-1.png",
                  },
                ],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [1],
            unresolvedLinks: { 1: post1Url },
            unresolvedLinkLists: { 1: [post1Url, post2Url, post3Url] },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const frameId = frameIdByUrl.get(targetUrl) ?? 90;

      openedFrameUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        const playlist = playlistByUrl.get(targetUrl);

        if (playlist) {
          harness.emitWebRequest({
            tabId,
            frameId: playlist.frameId,
            parentFrameId: 0,
            statusCode: 200,
            url: playlist.url,
          });
        }
      });

      return { ok: true };
    }

    if (message.type === "get-page-heading") {
      const title = headingsByFrameId.get(options.frameId ?? -1);

      if (title) return { title };
    }

    if (message.type === "extract-item-documents") {
      const documents = frameMaterialsById.get(options.frameId ?? -1);

      if (documents) return { documents };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sample Track", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 2);
  assert.deepEqual(openedFrameUrls, [post1Url, post2Url, post3Url]);
  assert.equal(scan.discovered.length, 2);

  const ytLesson = scan.discovered.find((item) => item.itemIndex === 0);

  assert.ok(ytLesson?.documents?.markdown.includes("youtube.com/watch?v="));

  const multiLesson = scan.discovered.find((item) => item.itemIndex === 1);

  assert.ok(multiLesson);
  assert.equal(multiLesson.title, "1.2 Workflow Patterns");
  assert.equal(multiLesson.primaryVideoTitle, "1.2 Reading Group - Patterns");

  assert.equal(
    multiLesson.url,
    "https://media.example.net/pattern-group-1/playlist.m3u8",
  );

  assert.equal(multiLesson.extraVideos?.length, 1);

  assert.equal(multiLesson.extraVideos?.[0]?.title, "1.2 Sample Lesson Video");

  assert.equal(
    multiLesson.extraVideos?.[0]?.url,
    "https://media.example.net/pattern-lesson-2/playlist.m3u8",
  );

  assert.equal(multiLesson.documents?.images.length, 2);
  assert.equal(multiLesson.documents?.diagrams.length, 1);
  assert.equal(multiLesson.documents?.extraNotes?.length, 3);

  assert.match(
    multiLesson.documents?.markdown || "",
    /^# 1\.2 Workflow Patterns/,
  );

  assert.ok(
    multiLesson.documents?.extraNotes?.some((note) =>
      note.markdown.includes("https://github.com/org/sample-repo"),
    ),
  );
});

test("Tier 1.5 stops at 1-hop for linked non-video child posts, skips self/duplicate URLs, and preserves parent lesson title", async () => {
  harness.reset();
  const sourceTabId = 41;

  const parentUrl =
    "https://training.example/c/sample-course/sections/10/lessons/950";

  const childPostUrl =
    "https://training.example/c/community/child-post-materials";

  const lessons = [
    {
      id: "950",
      url: parentUrl,
      fileTitle: "1.3 Linked Non-Video Child",
      folderPath: ["Sample Track", "1. Secao"],
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: parentUrl,
    title: "Playlist",
  });

  const openedFrameUrls: string[] = [];
  const childFinderCalled = { value: false };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: parentUrl,
      };

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            partial: true,
            stream: {
              url: "",
              mediaUrl: "",
              subtitles: [],
              sourceUrl: parentUrl,
              documents: {
                markdown: [
                  "# 1.3 Linked Non-Video Child",
                  "",
                  "**Vídeo:** [Parent YT](https://www.youtube.com/watch?v=vid11111111)",
                  "",
                  `[Post Extra](${childPostUrl})`,
                  "",
                ].join("\n"),
                images: [],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [0],
            unresolvedLinks: { 0: childPostUrl },
            unresolvedLinkLists: {
              0: [parentUrl, childPostUrl, `${childPostUrl}/`],
            },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");

      openedFrameUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId: 101, url: targetUrl },
        );
      });

      return { ok: true };
    }

    if (message.type === "find-linked-video-in-page") {
      childFinderCalled.value = true;

      return {
        ok: true,
        url: "https://training.example/c/community/grandchild-loop",
      };
    }

    if (message.type === "get-page-heading") {
      return { title: "Child Non-Video Heading" };
    }

    if (message.type === "extract-item-documents") {
      return {
        documents: {
          markdown:
            "# Child Non-Video Heading\n\nRepo: https://github.com/org/child-materials\n",
          images: [],
          pdfs: [
            {
              kind: "pdf",
              url: "https://assets.example.net/child-handout.pdf",
              filename: "child-handout.pdf",
            },
          ],
          diagrams: [],
          slides: [],
        },
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sample Track", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 1);
  assert.deepEqual(openedFrameUrls, [childPostUrl]);
  assert.equal(childFinderCalled.value, false);
  assert.equal(scan.discovered.length, 1);

  const entry = scan.discovered[0];

  assert.equal(entry.title, "1.3 Linked Non - Video Child");
  assert.equal(entry.url, "");

  assert.ok(
    entry.documents?.markdown.includes(
      "https://www.youtube.com/watch?v=vid11111111",
    ),
  );

  assert.equal(entry.documents?.pdfs.length, 1);

  assert.equal(
    entry.documents?.pdfs[0]?.url,
    "https://assets.example.net/child-handout.pdf",
  );

  assert.equal(entry.documents?.extraNotes?.length, 1);

  assert.ok(
    entry.documents?.extraNotes?.[0]?.markdown.includes(
      "https://github.com/org/child-materials",
    ),
  );
});

test("Tier 1.5 captures 2 direct MP4 event recordings linked from a primary-HLS lesson, extracts Trix materials, and enforces strict 1-hop depth", async () => {
  harness.reset();
  const sourceTabId = 45;

  const parentUrl =
    "https://training.example/c/sample-course/sections/10/lessons/5001";

  const event1Url = "https://training.example/c/community-events/session-alpha";

  const event2Url = "https://training.example/c/community-events/session-beta";

  const lessons = [
    {
      id: "5001",
      url: parentUrl,
      fileTitle: "1.1 O que vai ser construido",
      folderPath: ["(Playlist) Sample Course", "1. Intro"],
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: parentUrl,
    title: "Playlist",
  });

  harness.setFetchHandler(async (url) => {
    if (url.endsWith("playlist.m3u8")) {
      return new Response(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5.0,\nseg0.ts\n#EXT-X-ENDLIST\n",
        { status: 200 },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  const openedFrameUrls: string[] = [];
  const childFinderCalled = { value: false };

  const frameIdByUrl = new Map<string, number>([
    [event1Url, 111],
    [event2Url, 112],
  ]);

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: parentUrl,
      };

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-item-probed",
            requestId,
            itemIndex: 0,
            partial: true,
            stream: {
              url: "",
              mediaUrl: "https://media.example.net/main-5001/playlist.m3u8",
              subtitles: [],
              sourceUrl: parentUrl,
              documents: {
                markdown: [
                  "# 1.1 O que vai ser construido",
                  "",
                  `- [Session 1](${event1Url})`,
                  `- [Session 2](${event2Url})`,
                  "",
                ].join("\n"),
                images: [],
                pdfs: [],
                diagrams: [],
                slides: [],
              },
            },
          },
          sender,
        );

        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: [0],
            unresolvedLinks: { 0: event1Url },
            unresolvedLinkLists: { 0: [event1Url, event2Url] },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const frameId = frameIdByUrl.get(targetUrl) ?? 110;

      openedFrameUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (targetUrl === event1Url) {
          await harness.sendRuntimeMessage(
            {
              type: "page-playlist-stream",
              stream: {
                url: "",
                mediaUrl: "https://assets.example.net/live-event-1.mp4",
              },
            },
            { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
          );
        }
      });

      return { ok: true };
    }

    if (message.type === "collect-direct-video") {
      if (options.frameId === 112) {
        return { url: "https://assets.example.net/live-event-2.mp4" };
      }

      return { url: "" };
    }

    if (message.type === "find-linked-video-in-page") {
      childFinderCalled.value = true;

      return { ok: true, url: event1Url };
    }

    if (message.type === "get-page-heading") {
      return {
        title:
          options.frameId === 111
            ? "Sessao Apresentacao Sistema"
            : "Sessao Continuacao Design",
      };
    }

    if (message.type === "extract-item-documents") {
      if (options.frameId === 111) {
        return {
          documents: {
            markdown: "# Sessao Apresentacao Sistema\n\nResumo sessao 1.\n",
            images: [
              {
                kind: "image",
                url: "https://assets.example.net/session5.jpg",
                filename: "session5.jpg",
              },
            ],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        };
      }

      return {
        documents: {
          markdown: `# Sessao Continuacao Design\n\nVeja a [sessao anterior](${event1Url}).\n`,
          images: [
            {
              kind: "image",
              url: "https://assets.example.net/system-diagram.png",
              filename: "system-diagram.png",
            },
          ],
          pdfs: [],
          diagrams: [],
          slides: [],
        },
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sample Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 1);
  assert.deepEqual(openedFrameUrls, [event1Url, event2Url]);
  assert.equal(childFinderCalled.value, false);
  assert.equal(scan.discovered.length, 1);

  const entry = scan.discovered[0];

  assert.equal(entry.title, "1.1 O que vai ser construido");
  assert.equal(entry.primaryVideoTitle, "1.1 O que vai ser construido");

  assert.equal(entry.url, "https://media.example.net/main-5001/playlist.m3u8");

  assert.equal(entry.extraVideos?.length, 2);

  assert.equal(entry.extraVideos?.[0]?.kind, "direct");

  assert.equal(
    entry.extraVideos?.[0]?.url,
    "https://assets.example.net/live-event-1.mp4",
  );

  assert.equal(entry.extraVideos?.[1]?.kind, "direct");

  assert.equal(
    entry.extraVideos?.[1]?.url,
    "https://assets.example.net/live-event-2.mp4",
  );

  assert.equal(entry.documents?.images.length, 2);
  assert.equal(entry.documents?.extraNotes?.length, 2);
});

test("Tier 1.5 closes a linked-post firstRun frame, opens a clean course frame for sidebar lessons, and aborts cleanly when navigate-course-sidebar fails", async () => {
  harness.reset();
  const sourceTabId = 48;
  const playlistUrl = `${COURSE_ORIGIN}/c/sample-course/sections/1/lessons/10`;
  const linkedEventUrl = `${COURSE_ORIGIN}/c/events/sample-event-1`;
  const linkedMp4Url = "https://assets.example.net/sample-event-1.mp4";
  const sidebar104Url = "https://media.example.net/lesson-104/playlist.m3u8";
  const sidebar901Url = "https://media.example.net/lesson-901/playlist.m3u8";

  const lessons: readonly ApiLesson[] = [
    {
      id: "current-item",
      url: playlistUrl,
      fileTitle: "1.1 Introdução",
      folderPath: ["(Playlist) Sample Course", "1. Introdução"],
      navigationIndex: -1,
    },
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "1.3 O que vai ser construido",
      folderPath: ["(Playlist) Sample Course", "1. Introdução"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "1.4 Notas recursos exemplos",
      folderPath: ["(Playlist) Sample Course", "1. Introdução"],
      navigationIndex: 1,
    },
    {
      id: "btn-2",
      url: playlistUrl,
      fileTitle: "9.1 Introdução",
      folderPath: ["(Playlist) Sample Course", "9. Modulo Evolutivo"],
      navigationIndex: 2,
    },
    {
      id: "btn-3",
      url: playlistUrl,
      fileTitle: "10.1 Aula Inacessivel",
      folderPath: ["(Playlist) Sample Course", "10. Pronto para Producao"],
      navigationIndex: 3,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Sample Course",
  });

  await harness.chromeMock.storage.session.set({
    [`detections:${sourceTabId}`]: {
      pageUrl: playlistUrl,
      streams: [
        {
          key: "https://media.example.net/lesson-101/",
          url: "https://media.example.net/lesson-101/playlist.m3u8",
          host: "media.example.net",
          title: "1.1 Introdução",
          sourceUrl: playlistUrl,
          kind: "master",
          qualityOptions: [
            {
              url: "https://media.example.net/lesson-101/1080p/video.m3u8",
              label: "1080p",
            },
          ],
          subtitles: [
            {
              url: "https://media.example.net/lesson-101/pt.vtt",
              label: "Portuguese",
              language: "Portuguese",
            },
          ],
          detectedAt: Date.now(),
        },
      ],
      subtitles: [],
    },
  });

  harness.setFetchHandler(
    async () =>
      new Response(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
          "1080p/video.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
          "720p/video.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
          "480p/video.m3u8",
        ].join("\n"),
        { status: 200 },
      ),
  );

  const probeState = {
    linkedFrameId: 201,
    courseFrameId: 202,
    openedUrls: [] as string[],
    closedProbeIds: [] as string[],
    probeLessonFrames: [] as number[],
    navigatedSections: [] as string[],
    extractedMaterialFrames: [] as number[],
    collectedDirectFrames: [] as number[],
  };

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      probeState.probeLessonFrames.push(options.frameId ?? 0);
      const requestId = stringField(message, "requestId");

      const sender = {
        id: EXT_ID,
        tab: { id: tabId },
        frameId: options.frameId ?? 0,
        url: playlistUrl,
      };

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: { 1: linkedEventUrl },
            unresolvedLinkLists: { 1: [linkedEventUrl] },
          },
          sender,
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const targetUrl = stringField(message, "url");
      const probeId = stringField(message, "probeId");
      const isLinked = targetUrl === linkedEventUrl;

      const frameId = isLinked
        ? probeState.linkedFrameId
        : probeState.courseFrameId;

      probeState.openedUrls.push(targetUrl);

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
        );

        if (isLinked) {
          await harness.sendRuntimeMessage(
            {
              type: "page-playlist-stream",
              stream: { url: "", mediaUrl: linkedMp4Url },
            },
            { id: EXT_ID, tab: { id: tabId }, frameId, url: targetUrl },
          );
        }
      });

      return { ok: true };
    }

    if (message.type === "close-hidden-probe-frame") {
      probeState.closedProbeIds.push(stringField(message, "probeId"));

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === probeState.courseFrameId
    ) {
      probeState.navigatedSections.push(stringField(message, "itemSection"));
      const navIndex = message.itemIndex;

      if (navIndex === 3) return { ok: false };

      queueMicrotask(() => {
        harness.emitWebRequest({
          tabId,
          frameId: probeState.courseFrameId,
          parentFrameId: 0,
          statusCode: 200,
          url: navIndex === 1 ? sidebar104Url : sidebar901Url,
        });
      });

      return { ok: true };
    }

    if (message.type === "collect-direct-video") {
      probeState.collectedDirectFrames.push(options.frameId ?? -1);

      return { url: "" };
    }

    if (message.type === "extract-item-documents") {
      probeState.extractedMaterialFrames.push(options.frameId ?? -1);

      if (options.frameId === probeState.linkedFrameId) {
        return {
          documents: {
            markdown: "# Linked Event\n",
            images: [
              {
                kind: "image",
                url: "https://assets.example.net/linked-cover.png",
                filename: "linked-cover.png",
              },
            ],
            pdfs: [],
            diagrams: [],
            slides: [],
          },
        };
      }

      return {
        documents: {
          markdown: "# Normal Sidebar Lesson\n",
          images: [],
          pdfs: [],
          diagrams: [],
          slides: [],
        },
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Sample Course", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.nextItemIndex, 5);
  assert.deepEqual(probeState.probeLessonFrames, [0]);
  assert.deepEqual(probeState.openedUrls, [linkedEventUrl, playlistUrl]);
  assert.equal(probeState.closedProbeIds.length, 2);

  assert.deepEqual(probeState.navigatedSections, [
    "1. Introdução",
    "9. Modulo Evolutivo",
    "10. Pronto para Producao",
  ]);

  // Failed navigation for lesson 4 (10.1) aborted cleanly without scraping materials/direct video.
  assert.deepEqual(probeState.extractedMaterialFrames, [0, 201, 202, 202]);
  assert.deepEqual(probeState.collectedDirectFrames, []);
  assert.equal(scan.discovered.length, 4);

  const lesson104 = scan.discovered.find((item) => item.itemIndex === 2);
  const lesson901 = scan.discovered.find((item) => item.itemIndex === 3);

  assert.equal(lesson104?.url, sidebar104Url);
  assert.equal(lesson104?.qualityOptions?.length, 3);
  assert.equal(lesson104?.documents?.images.length, 0);
  assert.equal(lesson901?.url, sidebar901Url);
  assert.equal(lesson901?.qualityOptions?.length, 3);
});

test("Tier 1.5 ignores stale collect-direct-video matching previousStreamKey after sidebar navigation", async () => {
  harness.reset();
  const sourceTabId = 49;
  const playlistUrl = `${COURSE_ORIGIN}/c/sample-course/sections/2/lessons/20`;
  const directVideoUrl = "https://assets.example.net/direct-lesson-21.mp4";

  const lessons: readonly ApiLesson[] = [
    {
      id: "btn-0",
      url: playlistUrl,
      fileTitle: "2.1 Aula Direta",
      folderPath: ["(Playlist) Sample Course", "2. Modulos"],
      navigationIndex: 0,
    },
    {
      id: "btn-1",
      url: playlistUrl,
      fileTitle: "2.2 Aula Somente Nota",
      folderPath: ["(Playlist) Sample Course", "2. Modulos"],
      navigationIndex: 1,
    },
  ];

  harness.tabs.set(sourceTabId, {
    id: sourceTabId,
    url: playlistUrl,
    title: "Sample Course",
  });

  harness.setTabMessageHandler(async (tabId, message, options) => {
    if (message.type === "probe-playlist-items") {
      const requestId = stringField(message, "requestId");

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          {
            type: "playlist-items-probe-done",
            requestId,
            unresolvedIndices: probeLessons(message).map((l) => l.itemIndex),
            unresolvedLinks: {},
          },
          {
            id: EXT_ID,
            tab: { id: tabId },
            frameId: options.frameId ?? 0,
            url: playlistUrl,
          },
        );
      });

      return { ok: true };
    }

    if (message.type === "open-hidden-probe-frame") {
      const probeId = stringField(message, "probeId");

      queueMicrotask(async () => {
        await harness.sendRuntimeMessage(
          { type: "hidden-probe-frame-ready", probeId },
          { id: EXT_ID, tab: { id: tabId }, frameId: 211, url: playlistUrl },
        );
      });

      return { ok: true };
    }

    if (
      message.type === "navigate-playlist-sidebar" &&
      options.frameId === 211
    ) {
      if (message.itemIndex === 0) {
        queueMicrotask(async () => {
          await harness.sendRuntimeMessage(
            {
              type: "page-playlist-stream",
              stream: { url: "", mediaUrl: directVideoUrl },
            },
            { id: EXT_ID, tab: { id: tabId }, frameId: 211, url: playlistUrl },
          );
        });
      }

      return { ok: true };
    }

    if (message.type === "collect-direct-video" && options.frameId === 211) {
      return { url: directVideoUrl };
    }

    if (message.type === "extract-item-documents" && options.frameId === 211) {
      return {
        documents: {
          markdown: "# Nota da aula\n",
          images: [],
          pdfs: [],
          diagrams: [],
          slides: [],
        },
      };
    }

    return { ok: true };
  });

  const started = await harness.sendRuntimeMessage(
    {
      type: "start-playlist-scan",
      sourceTabId,
      outline: { title: "Enterprise", items: lessons },
    },
    extSender,
  );

  assert.ok(started?.scanId);
  const scan = await waitForScanReady(started.scanId, 12000);

  assert.ok(scan);
  assert.equal(scan.status, "ready");
  assert.equal(scan.discovered.length, 2);

  const first = scan.discovered.find((item) => item.itemIndex === 0);
  const second = scan.discovered.find((item) => item.itemIndex === 1);

  assert.equal(first?.url, directVideoUrl);
  assert.equal(second?.url, "");
  assert.equal(second?.qualityOptions?.length, 0);
  assert.equal(second?.documents?.markdown, "# Nota da aula\n");
});
