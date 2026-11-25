import {
  type MockTab,
  type MockWindow,
  type RuntimeMessageListener,
  type WebRequestListener,
  type TabRemovedListener,
  type CreatedTabRecord,
  type CreatedWindowRecord,
  type ExecuteScriptDetails,
  type RecordedTabMessage,
  type RecordedFetchCall,
  type TabMessageHandler,
  type FetchHandler,
  EXT_ID,
  EXT_ORIGIN,
  type MockTabCreateOptions,
  type TabMessageOptions,
  type MockWindowCreateOptions,
  type MessageSender,
  type RuntimeResponse,
  type WebRequestDetails,
} from "./headless-playlist-scan-types.ts";

export function createHarness() {
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

export const realSetTimeout = globalThis.setTimeout;
