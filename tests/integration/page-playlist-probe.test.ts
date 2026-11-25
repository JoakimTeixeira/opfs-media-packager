import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import type { ItemCompanionDocuments } from "../../lib/item-assets.ts";

interface ProbeLessonInput {
  readonly itemIndex: number;
  readonly id: string;
  readonly title: string;
  readonly sectionTitle?: string;
  readonly url: string;
}

interface ProbedSubtitle {
  readonly url?: string;
  readonly label?: string;
  readonly language?: string;
}

interface ProbedStream {
  readonly url?: string;
  readonly mediaUrl?: string;
  readonly linkedTitle?: string;
  readonly subtitles?: readonly ProbedSubtitle[];
  readonly documents?: ItemCompanionDocuments;
}

interface ProbeBatchResult {
  readonly discovered: Map<number, ProbedStream | null>;
  readonly partialLessons: Map<number, ProbedStream | null>;
  readonly unresolvedIndices: readonly number[];
  readonly unresolvedLinks: Readonly<Record<string, string>>;
  readonly unresolvedLinkLists: Readonly<Record<string, readonly string[]>>;
  readonly rateLimited: boolean;
}

interface ProbeMessageEvent {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
}

interface ProbeIncomingMessage {
  readonly requestId?: string;
  readonly type?: string;
  readonly itemIndex?: number;
  readonly stream?: ProbedStream | null;
  readonly partial?: boolean;
  readonly unresolvedIndices?: readonly number[];
  readonly unresolvedLinks?: Readonly<Record<string, string>>;
  readonly unresolvedLinkLists?: Readonly<Record<string, readonly string[]>>;
  readonly rateLimited?: boolean;
}

type MessageListener = (event: ProbeMessageEvent) => void;

type ProbeFetch = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ProbeSandboxOptions {
  readonly pageUrl?: string;
  readonly fetchImpl: ProbeFetch;
  readonly performanceEntries?: readonly Record<string, unknown>[];
  readonly domProps?: readonly Record<string, unknown>[];
}

class FakeXHR {
  _method = "";
  _url = "";

  open(method: string, url: string): void {
    this._method = method;
    this._url = url;
  }

  setRequestHeader(): void {}
  send(): void {}
  addEventListener(): void {}
}

interface ProbeWindow {
  [key: string]: unknown;
  location: URL;
  addEventListener(type: string, fn: MessageListener): void;
  postMessage(data: unknown, origin: string): void;
  fetch: ProbeFetch;
  XMLHttpRequest: typeof FakeXHR;
  performance: {
    getEntriesByType(type: string): readonly Record<string, unknown>[];
  };
  document: {
    querySelectorAll(
      selector: string,
    ): readonly { getAttribute: () => string }[];
  };
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
  Blob: typeof Blob;
  Response: typeof Response;
  DecompressionStream: typeof DecompressionStream;
  Uint8Array: typeof Uint8Array;
  atob: typeof atob;
  btoa: typeof btoa;
  setTimeout(
    fn: (...args: unknown[]) => void,
    delay?: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout: typeof clearTimeout;
  Object: typeof Object;
  Array: typeof Array;
  Map: typeof Map;
  Set: typeof Set;
  Promise: typeof Promise;
  JSON: typeof JSON;
  Number: typeof Number;
  String: typeof String;
  Boolean: typeof Boolean;
  RegExp: typeof RegExp;
  Math: typeof Math;
  window?: ProbeWindow;
  self?: ProbeWindow;
  globalThis?: ProbeWindow;
  __opfsMediaPackagerProbeLoaded?: boolean;
}

interface ProbeSandbox {
  readonly windowObj: ProbeWindow;
  readonly context: vm.Context;
  readonly postedMessages: readonly {
    readonly data: unknown;
    readonly origin: string;
  }[];
  readonly scheduledDelays: readonly number[];
  readonly runBatchProbe: (
    lessons: readonly ProbeLessonInput[],
  ) => Promise<ProbeBatchResult>;
}

const probeSource = await readFile(
  new URL("../../dist/page-playlist-probe.js", import.meta.url),
  "utf8",
);

const compiledProbeScript = new vm.Script(probeSource, {
  filename: "page-course-probe.js",
});

function encodeDeflatedEnvelope(payload: Record<string, unknown>): string {
  const compressed = deflateSync(Buffer.from(JSON.stringify(payload), "utf8"));

  return JSON.stringify({ content: compressed.toString("base64") });
}

function asProbeMessage(data: unknown): ProbeIncomingMessage | null {
  return data && typeof data === "object"
    ? (data as ProbeIncomingMessage)
    : null;
}

function fromVmRealm<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createProbeSandbox({
  pageUrl = "https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=7465",
  fetchImpl,
  performanceEntries = [],
  domProps = [],
}: ProbeSandboxOptions): ProbeSandbox {
  const listeners: MessageListener[] = [];
  const postedMessages: { data: unknown; origin: string }[] = [];
  const scheduledDelays: number[] = [];
  const parsedLocation = new URL(pageUrl);
  const frameRef: { vmWindow: unknown } = { vmWindow: null };

  const windowObj: ProbeWindow = {
    location: parsedLocation,
    addEventListener(type: string, fn: MessageListener) {
      if (type === "message") listeners.push(fn);
    },
    postMessage(data: unknown, origin: string) {
      postedMessages.push({ data, origin });

      queueMicrotask(() => {
        for (const fn of [...listeners]) {
          fn({
            source: frameRef.vmWindow || windowObj,
            origin: parsedLocation.origin,
            data,
          });
        }
      });
    },
    fetch: fetchImpl,
    XMLHttpRequest: FakeXHR,
    performance: {
      getEntriesByType(type: string) {
        return type === "resource" ? performanceEntries : [];
      },
    },
    document: {
      querySelectorAll(selector: string) {
        if (selector !== "[data-props]") return [];

        return domProps.map((value) => ({
          getAttribute: () => JSON.stringify(value),
        }));
      },
    },
    URL,
    URLSearchParams,
    Blob,
    Response,
    DecompressionStream,
    Uint8Array,
    atob,
    btoa,
    setTimeout(fn: (...args: unknown[]) => void, delay = 0) {
      scheduledDelays.push(delay);

      return setTimeout(fn, 0);
    },
    clearTimeout,
    Object,
    Array,
    Map,
    Set,
    Promise,
    JSON,
    Number,
    String,
    Boolean,
    RegExp,
    Math,
  };

  windowObj.window = windowObj;
  windowObj.self = windowObj;
  windowObj.globalThis = windowObj;

  const context = vm.createContext(windowObj);

  frameRef.vmWindow = vm.runInContext("window", context);
  compiledProbeScript.runInContext(context);

  function runBatchProbe(
    lessons: readonly ProbeLessonInput[],
  ): Promise<ProbeBatchResult> {
    const requestId = `req-${Math.random().toString(36).slice(2)}`;
    const discovered = new Map<number, ProbedStream | null>();
    const partialLessons = new Map<number, ProbedStream | null>();

    return new Promise((resolve) => {
      const onMessage: MessageListener = (event) => {
        const msg = asProbeMessage(event.data);

        if (msg?.requestId !== requestId) return;

        if (
          msg.type === "playlist-item-probed" &&
          typeof msg.itemIndex === "number"
        ) {
          if (msg.partial) {
            partialLessons.set(msg.itemIndex, msg.stream ?? null);

            return;
          }

          discovered.set(msg.itemIndex, msg.stream ?? null);
        }

        if (msg.type === "playlist-items-probe-done") {
          resolve({
            discovered,
            partialLessons,
            unresolvedIndices: msg.unresolvedIndices ?? [],
            unresolvedLinks: msg.unresolvedLinks ?? {},
            unresolvedLinkLists: msg.unresolvedLinkLists ?? {},
            rateLimited: Boolean(msg.rateLimited),
          });
        }
      };

      listeners.push(onMessage);

      windowObj.postMessage(
        {
          source: "opfs-media-packager",
          type: "probe-playlist-items",
          requestId,
          items: lessons,
        },
        parsedLocation.origin,
      );
    });
  }

  return { windowObj, context, postedMessages, scheduledDelays, runBatchProbe };
}

test("serializes and paces API-route requests (max 1 in-flight) and honors Retry-After on a single 429", async () => {
  const attempts = new Map<string, number>();
  const flight = { active: 0, max: 0 };

  const sandbox = createProbeSandbox({
    fetchImpl: async (url) => {
      flight.active += 1;
      flight.max = Math.max(flight.max, flight.active);
      await Promise.resolve();
      const id = /\/(\d+)\.json/.exec(String(url))?.[1] || "";
      const count = (attempts.get(id) || 0) + 1;

      attempts.set(id, count);
      flight.active -= 1;

      // Single transient 429 with Retry-After header recovers cleanly on retry.
      if (id === "7473" && count === 1) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "retry-after": "3" },
        });
      }

      return new Response(
        encodeDeflatedEnvelope({
          tipo: 7,
          url: `https://media.example.net/video-${id}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const lessons = Array.from({ length: 35 }, (_, index) => ({
    itemIndex: index,
    id: String(7465 + index),
    title: `1.${index + 1} Lesson ${index + 1}`,
    url: `https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=${7465 + index}`,
  }));

  const result = await sandbox.runBatchProbe(lessons);

  assert.equal(flight.max, 1);
  assert.equal(result.rateLimited, false);
  assert.equal(result.unresolvedIndices.length, 0);
  assert.equal(result.discovered.size, 35);

  assert.equal(
    result.discovered.get(34)?.url,
    "https://media.example.net/video-7499",
  );

  // Confirm polite pacing (>=500ms) and Retry-After (3000ms) were scheduled.
  assert.ok(sandbox.scheduledDelays.some((delay) => delay >= 2900));
});

test("trips the 429 circuit breaker on persistent throttling, stops remaining fetches, and skips SPA HTML fallback", async () => {
  const requestedUrls: string[] = [];

  const sandbox = createProbeSandbox({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      const id = /\/(\d+)\.json/.exec(String(url))?.[1] || "";

      if (id === "7465") {
        return new Response(
          encodeDeflatedEnvelope({
            tipo: 7,
            url: "https://media.example.net/video-7465",
          }),
          { status: 200 },
        );
      }

      return new Response("Rate limited", { status: 429 });
    },
  });

  const lessons = Array.from({ length: 10 }, (_, index) => ({
    itemIndex: index,
    id: String(7465 + index),
    title: `1.${index + 1} Lesson ${index + 1}`,
    url: `https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=${7465 + index}`,
  }));

  const result = await sandbox.runBatchProbe(lessons);

  assert.equal(result.rateLimited, true);
  assert.equal(result.discovered.size, 1);
  assert.equal(result.unresolvedIndices.length, 9);
  // Lesson 1 succeeded (1 fetch), lesson 2 failed twice with 429 (2 fetches) -> circuit tripped!
  assert.equal(requestedUrls.length, 3);

  // Never fetched SPA HTML pages after hitting 429.
  assert.equal(
    requestedUrls.some((url) => url.includes("/conteudos")),
    false,
  );
});

test("decodes non-[7,12] video tipo values and rejects HTTP 200 SPA HTML fallbacks as unresolved", async () => {
  const sandbox = createProbeSandbox({
    fetchImpl: async (url) => {
      const id = /\/(\d+)\.json/.exec(String(url))?.[1] || "";

      if (id === "8001") {
        // Non-standard tipo=15 containing a direct UUID video path should still be captured.
        return new Response(
          encodeDeflatedEnvelope({
            tipo: 15,
            url: "https://media.example.net/a1b2c3d4-e5f6-4789-abcd-ef0123456789/playlist.m3u8",
          }),
          { status: 200 },
        );
      }

      if (id === "8002") {
        // HTTP 200 SPA HTML fallback must NOT falsely mark lesson checked!
        return new Response("<!doctype html><html><body>SPA</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      // Valid text-only lesson (valid deflated envelope without video) -> checked with null stream.
      return new Response(
        encodeDeflatedEnvelope({ tipo: 1, texto: "Reading material only" }),
        { status: 200 },
      );
    },
  });

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "8001",
      title: "1.1 Custom tipo video",
      url: "https://training.example/courses/x/1/2/3/conteudos?conteudo=8001",
    },
    {
      itemIndex: 1,
      id: "8002",
      title: "1.2 SPA fallback",
      url: "https://training.example/courses/x/1/2/3/conteudos?conteudo=8002",
    },
    {
      itemIndex: 2,
      id: "8003",
      title: "1.3 Text article",
      url: "https://training.example/courses/x/1/2/3/conteudos?conteudo=8003",
    },
  ]);

  assert.equal(
    result.discovered.get(0)?.mediaUrl,
    "https://media.example.net/a1b2c3d4-e5f6-4789-abcd-ef0123456789/playlist.m3u8",
  );

  assert.deepEqual([...result.unresolvedIndices], [1]);
  assert.equal(result.discovered.has(2), true);
  assert.equal(result.discovered.get(2), null);
});

test("captures custom deflated-envelope API template from generic JSON fetch and reuses it across lessons", async () => {
  const requestedUrls: string[] = [];

  const sandbox = createProbeSandbox({
    pageUrl:
      "https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=9001",
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      const id = /(\d+)$/.exec(String(url))?.[1] || "9001";

      return new Response(
        encodeDeflatedEnvelope({
          tipo: 7,
          url: `https://media.example.net/custom-${id}/playlist.m3u8`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  // Simulate the page's own SPA fetching a non-default API endpoint for the active lesson.
  await sandbox.windowObj.fetch("https://training.example/api/v2/items/9001");
  await new Promise<void>((r) => setTimeout(r, 40));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "9002",
      title: "1.2 Second lesson",
      url: "https://training.example/courses/course-uuid/177/168/136/conteudos?capitulo=136&conteudo=9002",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  assert.equal(
    result.discovered.get(0)?.mediaUrl,
    "https://media.example.net/custom-9002/playlist.m3u8",
  );

  assert.ok(
    requestedUrls.includes("https://training.example/api/v2/items/9002"),
  );
});

test("extracts deep subtitles via BFS and resolves linked video post with its own title", async () => {
  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/101",
    domProps: [
      {
        sections: [
          {
            id: 10,
            lessons: [
              { id: 101, name: "1.1 Active", section_id: 10 },
              { id: 102, name: "1.2 Linked Workshop", section_id: 10 },
            ],
          },
        ],
      },
    ],
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/101")) {
        return new Response(
          JSON.stringify({
            id: 101,
            media: {
              hls_url: "https://media.example.net/101/master.m3u8",
              nested: {
                captions: [
                  {
                    vtt_url: "https://media.example.net/101/pt.vtt",
                    language: "pt-BR",
                    label: "Português",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/102")) {
        return new Response(
          JSON.stringify({
            id: 102,
            body_html:
              '<p>Watch here: <a href="https://training.example/c/workshops/architecture-live">Workshop</a></p>',
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/c/workshops/architecture-live")) {
        return new Response(
          '<!doctype html><html><head><title>Architecture Live Session | Portal</title></head><body><script>var u="https://media.example.net/workshop/playlist.m3u8"; var s="https://media.example.net/workshop/en.vtt";</script></body></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/101",
  );

  await new Promise<void>((r) => setTimeout(r, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "101",
      title: "1.1 Active",
      url: "https://training.example/c/ai/sections/10/lessons/101",
    },
    {
      itemIndex: 1,
      id: "102",
      title: "1.2 Linked Workshop",
      url: "https://training.example/c/ai/sections/10/lessons/102",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  assert.equal(
    result.discovered.get(0)?.subtitles?.[0]?.url,
    "https://media.example.net/101/pt.vtt",
  );

  assert.equal(
    result.discovered.get(1)?.mediaUrl,
    "https://media.example.net/workshop/playlist.m3u8",
  );

  assert.equal(
    result.discovered.get(1)?.linkedTitle,
    "Architecture Live Session",
  );
});

test("remains idempotent when re-executed via chrome.scripting.executeScript", () => {
  const sandbox = createProbeSandbox({
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });

  assert.equal(sandbox.windowObj.__opfsMediaPackagerProbeLoaded, true);

  // Executing the script a second time should be a safe no-op.
  assert.doesNotThrow(() => {
    compiledProbeScript.runInContext(sandbox.context);
  });
});

test("extracts transcript webvtt_file_url from player config JSON while ignoring mosaic.vtt storyboards", async () => {
  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/98/lessons/3727",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/98/lessons/3727")) {
        return new Response(
          JSON.stringify({
            id: 3727,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/video-3727/hls/playlist.m3u8",
              },
              preview_thumbnails_url:
                "https://media.example.net/video-3727/mosaic.vtt",
              transcript: {
                id: 3824457,
                enabled: true,
                selected_file: "ai",
                webvtt_file_url:
                  "https://assets.example.net/transcript-3824457",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/98/lessons/3727",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "3727",
      title: "1.1 Transcript Lesson",
      url: "https://training.example/c/ai/sections/98/lessons/3727",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  const discovered = result.discovered.get(0);

  assert.equal(
    discovered?.mediaUrl,
    "https://media.example.net/video-3727/hls/playlist.m3u8",
  );

  assert.deepEqual(
    [...(discovered?.subtitles || [])].map((track) => track.url),
    ["https://assets.example.net/transcript-3824457"],
  );
});

test("shares rate-limit pacing (max 1 in-flight), Retry-After backoff, and 2-strike 429 circuit breaker across sidebar course adapters", async () => {
  const attempts = new Map<string, number>();
  const requestedUrls: string[] = [];
  const flight = { active: 0, max: 0 };

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/101",
    fetchImpl: async (url) => {
      const target = String(url);

      requestedUrls.push(target);
      flight.active += 1;
      flight.max = Math.max(flight.max, flight.active);
      await Promise.resolve();
      const count = (attempts.get(target) || 0) + 1;

      attempts.set(target, count);
      flight.active -= 1;

      if (target.endsWith("/api/sections/10/lessons/101")) {
        return new Response(
          JSON.stringify({
            id: 101,
            media: { hls_url: "https://media.example.net/101/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Transient 429 on Lesson 102 recovers on retry after honoring Retry-After.
      if (target.endsWith("/api/sections/10/lessons/102")) {
        if (count === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "retry-after": "2" },
          });
        }

        return new Response(
          JSON.stringify({
            id: 102,
            media: { hls_url: "https://media.example.net/102/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Persistent 429 on Lesson 103 trips the 2-strike circuit breaker so Lesson 104 is never requested.
      return new Response("Too Many Requests", { status: 429 });
    },
  });

  // Prime the generic lesson API template from the active sidebar lesson.
  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/101",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  requestedUrls.length = 0;

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "102",
      title: "1.2 Transient 429 Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/102",
    },
    {
      itemIndex: 1,
      id: "103",
      title: "1.3 Persistent 429 Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/103",
    },
    {
      itemIndex: 2,
      id: "104",
      title: "1.4 Should Not Be Hammered",
      url: "https://training.example/c/ai/sections/10/lessons/104",
    },
  ]);

  assert.equal(flight.max, 1);
  assert.equal(result.rateLimited, true);

  assert.equal(
    result.discovered.get(0)?.mediaUrl,
    "https://media.example.net/102/master.m3u8",
  );

  assert.deepEqual([...result.unresolvedIndices], [1, 2]);
  assert.ok(sandbox.scheduledDelays.some((delay) => delay >= 1900));

  // Lesson 102 took 2 requests (429 + 200), Lesson 103 took 2 requests (429 + 429 -> tripped),
  // and Lesson 104 was never requested ( nor was any HTML fallback attempted).
  assert.equal(requestedUrls.length, 4);

  assert.equal(
    requestedUrls.some((url) => url.includes("104")),
    false,
  );

  // A 1-lesson batch hitting 429 in fetchGenericLessonPayload must still report
  // rateLimited: true directly without relying on a subsequent queued lesson.
  const singleLessonResult = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "105",
      title: "1.5 Final Lesson 429",
      url: "https://training.example/c/ai/sections/10/lessons/105",
    },
  ]);

  assert.equal(singleLessonResult.rateLimited, true);
  assert.deepEqual([...singleLessonResult.unresolvedIndices], [0]);
});

test("propagates rateLimited explicitly through linked-video HTML resolution without hammering subsequent lessons", async () => {
  const requestedUrls: string[] = [];

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/201",
    fetchImpl: async (url) => {
      const target = String(url);

      requestedUrls.push(target);

      if (target.endsWith("/api/sections/10/lessons/201")) {
        return new Response(
          JSON.stringify({
            id: 201,
            media: { hls_url: "https://media.example.net/201/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/202")) {
        return new Response(
          JSON.stringify({
            id: 202,
            body_html:
              '<a href="https://training.example/c/workshops/rate-limited-live">Live Workshop</a>',
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Linked workshop page responds with persistent 429s.
      return new Response("Too Many Requests", { status: 429 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/201",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  requestedUrls.length = 0;

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "202",
      title: "2.2 Linked Lesson With 429 Target",
      url: "https://training.example/c/ai/sections/10/lessons/202",
    },
    {
      itemIndex: 1,
      id: "203",
      title: "2.3 Must Not Be Requested",
      url: "https://training.example/c/ai/sections/10/lessons/203",
    },
  ]);

  assert.equal(result.rateLimited, true);
  assert.deepEqual([...result.unresolvedIndices], [0, 1]);

  assert.equal(
    requestedUrls.some((url) => url.includes("203")),
    false,
  );
});

test("emits /media_transcripts/<id>.vtt from media_transcript_id with or without webvtt_file_url", async () => {
  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/501",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/501")) {
        return new Response(
          JSON.stringify({
            id: 501,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/501/master.m3u8",
              },
              transcript: {
                media_transcript_id: 4242395,
                enabled: true,
                language: "pt-BR",
                label: "Português",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/502")) {
        return new Response(
          JSON.stringify({
            id: 502,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/502/master.m3u8",
              },
              transcript: {
                media_transcript_id: "4242396",
                enabled: true,
                webvtt_file_url: "",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/503")) {
        return new Response(
          JSON.stringify({
            id: 503,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/503/master.m3u8",
              },
              transcript: {
                media_transcript_id: 4242397,
                enabled: true,
                webvtt_file_url:
                  "https://assets.example.net/transcript-4242397",
                srclang: "en",
                label: "English",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/504")) {
        return new Response(
          JSON.stringify({
            id: 504,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/504/master.m3u8",
              },
              transcript: {
                media_transcript_id: 4242398,
                enabled: false,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/501",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "501",
      title: "1.1 Transcript ID Only",
      url: "https://training.example/c/ai/sections/10/lessons/501",
    },
    {
      itemIndex: 1,
      id: "502",
      title: "1.2 String Transcript ID",
      url: "https://training.example/c/ai/sections/10/lessons/502",
    },
    {
      itemIndex: 2,
      id: "503",
      title: "1.3 Both Candidates",
      url: "https://training.example/c/ai/sections/10/lessons/503",
    },
    {
      itemIndex: 3,
      id: "504",
      title: "1.4 Disabled Transcript",
      url: "https://training.example/c/ai/sections/10/lessons/504",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  assert.deepEqual(fromVmRealm(result.discovered.get(0)?.subtitles), [
    {
      url: "https://training.example/media_transcripts/4242395.vtt",
      language: "pt-BR",
      label: "Português",
    },
  ]);

  assert.deepEqual(
    [...(result.discovered.get(1)?.subtitles || [])].map((track) => track.url),
    ["https://training.example/media_transcripts/4242396.vtt"],
  );

  assert.deepEqual(
    [...(result.discovered.get(2)?.subtitles || [])].map((track) => track.url),
    [
      "https://assets.example.net/transcript-4242397",
      "https://training.example/media_transcripts/4242397.vtt",
    ],
  );

  assert.deepEqual(
    fromVmRealm([...(result.discovered.get(3)?.subtitles || [])]),
    [],
  );
});

test("extracts rich_text_body materials for video and materials-only lessons", async () => {
  const richTextPayload = {
    inline_attachments: [
      {
        signed_id: "sig-pdf-601",
        url: "https://assets.example.net/pdf-blob",
        filename: "architecture-guide.pdf",
        content_type: "application/pdf",
      },
      {
        signed_id: "sig-img-601",
        url: "https://assets.example.net/rails/active_storage/representations/redirect/sig-img-601/large/diagram.png",
        filename: "diagram.png",
        content_type: "image/png",
        image_variants: {
          original: "https://assets.example.net/originals/diagram.png",
          large: "https://assets.example.net/large/diagram.png",
        },
      },
    ],
    body: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Key Takeaways" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Top item" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Nested item" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            {
              type: "text",
              text: "Reference",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://training.example/docs/reference" },
                },
              ],
            },
            { type: "text", text: ", " },
            {
              type: "text",
              text: "System Diagram",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://app.excalidraw.com/s/arch-map" },
                },
              ],
            },
            { type: "text", text: ", and " },
            {
              type: "text",
              text: "Architecture Deck",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://slides.example/architecture?slide=9",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/601",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/601")) {
        return new Response(
          JSON.stringify({
            id: 601,
            name: "Materials Only Lesson",
            rich_text_body: richTextPayload,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/602")) {
        return new Response(
          JSON.stringify({
            id: 602,
            name: "Video And Materials Lesson",
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/602/master.m3u8",
              },
            },
            rich_text_body: richTextPayload,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  // Active lesson 601 has no video stream, only rich_text_body; template must still be captured.
  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/601",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "601",
      title: "1.1 Materials Only Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/601",
    },
    {
      itemIndex: 1,
      id: "602",
      title: "1.2 Video And Materials Lesson",
      url: "https://training.example/c/ai/sections/10/lessons/602",
    },
  ]);

  assert.equal(result.unresolvedIndices.length, 0);

  const materialsOnly = result.discovered.get(0);

  assert.equal(materialsOnly?.url, "");
  assert.equal(materialsOnly?.mediaUrl, "");
  assert.ok(materialsOnly?.documents);

  assert.match(
    materialsOnly.documents.markdown,
    /^# 1\.1 Materials Only Lesson\n\n## Key Takeaways\n\n- Top item\n {2}- Nested item\n\nRead \[Reference\]\(https:\/\/training\.example\/docs\/reference\)/,
  );

  assert.deepEqual(fromVmRealm(materialsOnly.documents.pdfs), [
    {
      kind: "pdf",
      url: "https://assets.example.net/pdf-blob",
      filename: "architecture-guide.pdf",
      contentType: "application/pdf",
    },
  ]);

  assert.deepEqual(fromVmRealm(materialsOnly.documents.images), [
    {
      kind: "image",
      url: "https://assets.example.net/originals/diagram.png",
      fallbackUrl:
        "https://assets.example.net/rails/active_storage/representations/redirect/sig-img-601/large/diagram.png",
      filename: "diagram.png",
      contentType: "image/png",
    },
  ]);

  assert.deepEqual(fromVmRealm(materialsOnly.documents.diagrams), [
    {
      kind: "diagram",
      url: "https://app.excalidraw.com/s/arch-map",
      title: "System Diagram",
    },
  ]);

  assert.deepEqual(fromVmRealm(materialsOnly.documents.slides), [
    {
      kind: "slides",
      url: "https://slides.example/architecture?slide=9",
      title: "Architecture Deck",
    },
  ]);

  const videoAndMaterials = result.discovered.get(1);

  assert.equal(
    videoAndMaterials?.mediaUrl,
    "https://media.example.net/602/master.m3u8",
  );

  assert.ok(videoAndMaterials?.documents);

  assert.match(
    videoAndMaterials.documents.markdown,
    /^# 1\.2 Video And Materials Lesson\n/,
  );

  assert.equal(videoAndMaterials.documents.pdfs.length, 1);
  assert.equal(videoAndMaterials.documents.images.length, 1);
  assert.equal(videoAndMaterials.documents.diagrams.length, 1);
  assert.equal(videoAndMaterials.documents.slides.length, 1);
});

test("fetchMediaFromPage allows subtitle and /media_transcripts paths with appropriate credentials", async () => {
  const fetchCalls: { url: string; credentials?: RequestCredentials }[] = [];

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/ai/sections/10/lessons/701",
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), credentials: init?.credentials });

      return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n", {
        status: 200,
      });
    },
  });

  const requestMedia = (
    url: string,
    responseType: "text" | "bytes",
  ): Promise<{ readonly status: number; readonly body: string }> => {
    const requestId = `media-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {
      sandbox.windowObj.addEventListener("message", (event) => {
        const data = event.data as {
          readonly type?: string;
          readonly requestId?: string;
          readonly response?: {
            readonly status: number;
            readonly body: string;
          };
        };

        if (
          data?.type === "fetch-media-result" &&
          data.requestId === requestId &&
          data.response
        ) {
          resolve(data.response);
        }
      });

      sandbox.windowObj.postMessage(
        {
          source: "opfs-media-packager",
          type: "fetch-media",
          requestId,
          responseType,
          url,
        },
        "https://training.example",
      );
    });
  };

  const sameOrigin = await requestMedia(
    "https://training.example/media_transcripts/4242395.vtt",
    "text",
  );

  assert.equal(sameOrigin.status, 200);
  assert.match(sameOrigin.body, /^WEBVTT/);

  const externalVtt = await requestMedia(
    "https://assets.example.net/tracks/en.vtt",
    "text",
  );

  assert.equal(externalVtt.status, 200);
  assert.match(externalVtt.body, /^WEBVTT/);

  const blocked = await requestMedia(
    "https://training.example/api/sections/10/lessons/701.json",
    "text",
  );

  assert.deepEqual(fromVmRealm(blocked), { status: 0, body: "" });

  const sameOriginBytes = await requestMedia(
    "https://training.example/media_transcripts/4242395",
    "bytes",
  );

  assert.equal(sameOriginBytes.status, 200);

  assert.match(
    Buffer.from(sameOriginBytes.body, "base64").toString("utf8"),
    /^WEBVTT/,
  );

  assert.deepEqual(fetchCalls, [
    {
      url: "https://training.example/media_transcripts/4242395.vtt",
      credentials: "include",
    },
    {
      url: "https://assets.example.net/tracks/en.vtt",
      credentials: "omit",
    },
    {
      url: "https://training.example/media_transcripts/4242395",
      credentials: "include",
    },
  ]);
});

test("resolves YouTube embed lessons in Tier 1, preserves partial materials across multi-post entity lessons, extracts disabled transcripts with webvtt_file_url, and reports community media_settings transcripts", async () => {
  const youtubeLessonPayload = {
    id: 801,
    name: "YouTube Technical Talk",
    featured_media: null,
    featured_media_embed: {
      embed_type: "video",
      title: "Streaming Patterns Talk",
      content: "https://youtu.be/vid22222222",
      html: '<iframe src="https://www.youtube.com/embed/vid22222222?rel=0"></iframe>',
    },
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Notes on fan-out patterns." }],
          },
        ],
      },
    },
  };

  const youtubeWithPostPayload = {
    id: 802,
    name: "Sample Workshop",
    featured_media_embed: {
      embed_type: "video",
      title: "Sample Workshop Session",
      html: '<iframe src="https://www.youtube.com/embed/vid11111111?rel=0"></iframe>',
    },
    rich_text_body: {
      sgids_to_object_map: {
        "sgid-es": {
          name: "Workshop Post",
          url: "https://training.example/c/community/sample-workshop-post",
        },
      },
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-es" } }],
          },
        ],
      },
    },
  };

  const multiPostLessonPayload = {
    id: 803,
    name: "Workflow Patterns",
    featured_media: null,
    rich_text_body: {
      inline_attachments: [
        {
          signed_id: "img-pat-1",
          url: "https://assets.example.net/rails/active_storage/blobs/redirect/img1/pat1.png",
          filename: "pattern-banner-1.png",
          content_type: "image/png",
        },
        {
          signed_id: "img-pat-2",
          url: "https://assets.example.net/rails/active_storage/blobs/redirect/img2/pat2.png",
          filename: "pattern-banner-2.png",
          content_type: "image/png",
        },
        {
          signed_id: "img-pat-3",
          url: "https://assets.example.net/rails/active_storage/blobs/redirect/img3/pat3.png",
          filename: "pattern-table.png",
          content_type: "image/png",
        },
      ],
      sgids_to_object_map: {
        "sgid-p1": {
          name: "Reading Group - Patterns",
          url: "https://training.example/c/events/reading-group-patterns",
        },
        "sgid-p2": {
          name: "Sample Lesson Video",
          url: "https://training.example/c/community-lessons/sample-lesson",
        },
        "sgid-p3": {
          name: "Pattern Notes",
          url: "https://training.example/c/notes/pattern-notes",
        },
        "sgid-rel": {
          name: "Relacionado Ignorado",
          url: "https://training.example/c/community-lessons/related-ignored",
        },
      },
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-p1" } }],
          },
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-p2" } }],
          },
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-p3" } }],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Conteúdos relacionados" }],
          },
          {
            type: "paragraph",
            content: [{ type: "entity", attrs: { sgid: "sgid-rel" } }],
          },
        ],
      },
    },
  };

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/sample-course/sections/10/lessons/801",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/10/lessons/801")) {
        return new Response(JSON.stringify(youtubeLessonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/802")) {
        return new Response(JSON.stringify(youtubeWithPostPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/803")) {
        return new Response(JSON.stringify(multiPostLessonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/804")) {
        return new Response(
          JSON.stringify({
            id: 804,
            media_settings: {
              video_variants: {
                hls: "https://media.example.net/804/master.m3u8",
              },
              transcript: {
                id: 1348709,
                enabled: false,
                selected_file: "ai",
                webvtt_file_url: "https://assets.example.net/ai-1348709",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/c/community/sample-workshop-post")) {
        return new Response("<html><div>SPA post shell</div></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      if (target.includes("/internal_api/media_settings/blob-1")) {
        return new Response(
          JSON.stringify({
            transcript: {
              id: 1348709,
              enabled: false,
              webvtt_file_url:
                "https://assets.example.net/community-ai-sub.vtt",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/801",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "801",
      title: "3.4 Streaming Intro",
      url: "https://training.example/c/sample-course/sections/10/lessons/801",
    },
    {
      itemIndex: 1,
      id: "802",
      title: "1.5 Sample Workshop",
      url: "https://training.example/c/sample-course/sections/10/lessons/802",
    },
    {
      itemIndex: 2,
      id: "803",
      title: "3.10 Workflow Patterns",
      url: "https://training.example/c/sample-course/sections/10/lessons/803",
    },
    {
      itemIndex: 3,
      id: "804",
      title: "3.11 AI Subtitle Flag",
      url: "https://training.example/c/sample-course/sections/10/lessons/804",
    },
  ]);

  // YouTube-only lesson resolves in Tier 1 with YouTube link in Markdown.
  const ytOnly = result.discovered.get(0);

  assert.ok(ytOnly?.documents);

  assert.ok(
    ytOnly.documents.markdown.includes(
      "**Vídeo:** [Streaming Patterns Talk](https://youtu.be/vid22222222)",
    ),
  );

  // Disabled AI transcript WITH explicit webvtt_file_url is preserved.
  assert.deepEqual(
    [...(result.discovered.get(3)?.subtitles || [])].map((track) => track.url),
    ["https://assets.example.net/ai-1348709"],
  );

  // Both SPA post + YouTube lesson (802) and multi-post lesson (803) are in unresolvedIndices with partial materials preserved!
  assert.deepEqual(fromVmRealm(result.unresolvedIndices), [1, 2]);

  assert.equal(
    result.unresolvedLinks["1"],
    "https://training.example/c/community/sample-workshop-post",
  );

  assert.ok(
    result.partialLessons
      .get(1)
      ?.documents?.markdown.includes(
        "**Vídeo:** [Sample Workshop Session](https://www.youtube.com/watch?v=vid11111111)",
      ),
  );

  assert.deepEqual(fromVmRealm(result.unresolvedLinkLists["2"]), [
    "https://training.example/c/events/reading-group-patterns",
    "https://training.example/c/community-lessons/sample-lesson",
    "https://training.example/c/notes/pattern-notes",
  ]);

  const multiPartial = result.partialLessons.get(2)?.documents;

  assert.ok(multiPartial);
  assert.equal(multiPartial.images.length, 3);

  assert.ok(
    multiPartial.markdown.includes(
      "[Sample Lesson Video](https://training.example/c/community-lessons/sample-lesson)",
    ),
  );

  // Community post media_settings fetch emits page-subtitle-tracks even when path has no /lessons/<id>.
  const communitySandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/community-lessons/sample-lesson",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          transcript: {
            id: 1348709,
            enabled: false,
            webvtt_file_url: "https://assets.example.net/community-ai-sub.vtt",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await communitySandbox.windowObj.fetch(
    "https://training.example/internal_api/media_settings/blob-1",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const subtitlePost = communitySandbox.postedMessages.find(
    (entry) =>
      (entry.data as { readonly type?: string })?.type ===
      "page-subtitle-tracks",
  );

  assert.ok(subtitlePost);

  assert.deepEqual(
    fromVmRealm(
      (
        subtitlePost.data as {
          readonly tracks: readonly { readonly url: string }[];
        }
      ).tracks.map((track) => track.url),
    ),
    ["https://assets.example.net/community-ai-sub.vtt"],
  );
});

test("merges single-hop child post video, Markdown, and materials in Tier 1 without fetching grandchild links", async () => {
  const fetchedUrls: string[] = [];

  const parentLessonWithChild = {
    id: 901,
    name: "Parent Lesson",
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Parent summary." }],
          },
          {
            type: "entity",
            attrs: { sgid: "sgid-child" },
          },
        ],
      },
      sgids_to_object_map: {
        "sgid-child": {
          url: "https://training.example/c/course/sections/10/lessons/902",
          title: "Child Video Post",
        },
      },
    },
  };

  const childLessonWithMaterialsAndGrandchild = {
    id: 902,
    name: "Child Video Post",
    featured_media_embed: {
      title: "Architecture Talk",
      html: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Architecture Talk"></iframe>',
    },
    media_settings: {
      video_variants: {
        hls: "https://media.example.net/child-902/master.m3u8",
      },
    },
    rich_text_body: {
      inline_attachments: [
        {
          signed_id: "pdf-child-1",
          url: "https://assets.example.net/child-guide.pdf",
          filename: "child-guide.pdf",
          content_type: "application/pdf",
        },
      ],
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Repo: " },
              {
                type: "text",
                text: "GitHub",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://github.com/org/child-repo" },
                  },
                ],
              },
              { type: "text", text: " and next " },
              {
                type: "text",
                text: "Grandchild Post",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://training.example/c/comunidade/grandchild-never-fetch",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const parentHtmlPost = {
    id: 903,
    name: "HTML Child Lesson",
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Child Community Post",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://training.example/c/comunidade/child-html-only",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const htmlChildDataProps = JSON.stringify({
    post: {
      name: "Community Notes & YouTube",
      featured_media_embed: {
        title: "Child YT",
        content: "https://youtu.be/abc123XYZ00",
      },
      rich_text_body: {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "HTML post body." }],
            },
            {
              type: "embed",
              attrs: {
                src: "https://training.example/c/comunidade/grandchild-never-fetch",
                title: "Nested Grandchild",
              },
            },
          ],
        },
      },
    },
  }).replace(/"/g, "&quot;");

  const sandbox = createProbeSandbox({
    pageUrl: "https://training.example/c/course/sections/10/lessons/900",
    fetchImpl: async (url) => {
      const target = String(url);

      fetchedUrls.push(target);

      if (target.endsWith("/api/sections/10/lessons/900")) {
        return new Response(
          JSON.stringify({
            id: 900,
            media: { hls_url: "https://media.example.net/900/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/901")) {
        return new Response(JSON.stringify(parentLessonWithChild), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/api/sections/10/lessons/902")) {
        return new Response(
          JSON.stringify(childLessonWithMaterialsAndGrandchild),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (target.endsWith("/api/sections/10/lessons/903")) {
        return new Response(JSON.stringify(parentHtmlPost), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.endsWith("/c/comunidade/child-html-only")) {
        return new Response(
          `<html><body><div data-props="${htmlChildDataProps}"></div></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/10/lessons/900",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  fetchedUrls.length = 0;

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "901",
      title: "1.1 Linked Api Child",
      url: "https://training.example/c/course/sections/10/lessons/901",
    },
    {
      itemIndex: 1,
      id: "903",
      title: "1.2 Linked Html Child",
      url: "https://training.example/c/course/sections/10/lessons/903",
    },
  ]);

  assert.deepEqual(fromVmRealm(result.unresolvedIndices), []);

  const apiResolved = result.discovered.get(0);

  assert.equal(
    apiResolved?.mediaUrl,
    "https://media.example.net/child-902/master.m3u8",
  );

  assert.equal(apiResolved?.documents?.pdfs.length, 1);

  assert.equal(
    apiResolved?.documents?.pdfs[0]?.url,
    "https://assets.example.net/child-guide.pdf",
  );

  assert.equal(apiResolved?.documents?.extraNotes?.length, 1);

  assert.ok(
    apiResolved?.documents?.extraNotes?.[0]?.markdown.includes(
      "https://github.com/org/child-repo",
    ),
  );

  assert.ok(
    apiResolved?.documents?.extraNotes?.[0]?.markdown.includes(
      "youtube.com/watch?v=dQw4w9WgXcQ",
    ),
  );

  const htmlResolved = result.discovered.get(1);

  assert.equal(htmlResolved?.mediaUrl, "");
  assert.equal(htmlResolved?.documents?.extraNotes?.length, 1);

  assert.ok(
    htmlResolved?.documents?.extraNotes?.[0]?.markdown.includes(
      "youtu.be/abc123XYZ00",
    ),
  );

  assert.equal(
    fetchedUrls.some((url) => url.includes("grandchild-never-fetch")),
    false,
  );
});

test("keeps probing 1-hop supplementary event links on lessons that already have a primary HLS video and detects direct MP4 event streams", async () => {
  const live1Url = "https://training.example/c/community-events/session-alpha";

  const live2Url = "https://training.example/c/community-events/session-beta";

  const lessonPayload = {
    id: 5002,
    name: "O que vai ser construido",
    featured_media: {
      hls_url: "https://media.example.net/main-5002/hls/playlist.m3u8",
      webvtt_file_url: "https://training.example/media_transcripts/607349.vtt",
    },
    rich_text_body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Lives onde discutimos:" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Live 1",
                        marks: [{ type: "link", attrs: { href: live1Url } }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Live 2",
                        marks: [{ type: "link", attrs: { href: live2Url } }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Proxima aula",
                        marks: [
                          {
                            type: "link",
                            attrs: {
                              href: "https://training.example/c/sample-course/sections/301/lessons/999999",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Conteúdos relacionados" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Related post",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://training.example/c/community-events/related-post",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const sandbox = createProbeSandbox({
    pageUrl:
      "https://training.example/c/sample-course/sections/301/lessons/5001",
    fetchImpl: async (url) => {
      const target = String(url);

      if (target.endsWith("/api/sections/301/lessons/5001")) {
        return new Response(
          JSON.stringify({
            id: 5001,
            media: { hls_url: "https://media.example.net/5001/master.m3u8" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.endsWith("/api/sections/301/lessons/5002")) {
        return new Response(JSON.stringify(lessonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/api/sections/301/lessons/5001",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "5002",
      title: "1.1 O que vai ser construido",
      url: "https://training.example/c/sample-course/sections/301/lessons/5002",
    },
  ]);

  assert.deepEqual(fromVmRealm(result.unresolvedIndices), [0]);

  assert.deepEqual(fromVmRealm(result.unresolvedLinkLists["0"]), [
    live1Url,
    live2Url,
  ]);

  const partial = result.partialLessons.get(0);

  assert.ok(partial);

  assert.equal(
    partial.mediaUrl,
    "https://media.example.net/main-5002/hls/playlist.m3u8",
  );

  assert.deepEqual(
    fromVmRealm((partial.subtitles || []).map((track) => track.url)),
    ["https://training.example/media_transcripts/607349.vtt"],
  );

  assert.ok(partial.documents?.markdown.includes(live1Url));

  // Event post & media_settings endpoints with direct MP4 variants emit course-stream.
  const eventSandbox = createProbeSandbox({
    pageUrl: live1Url,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 6718622,
          video_variants: {
            hls: null,
            original: "https://assets.example.net/live-event-1.mp4",
          },
          blob_url: "https://assets.example.net/live-event-1.mp4",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await eventSandbox.windowObj.fetch(
    "https://training.example/internal_api/media_settings/blob-event-1",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  const directStreamPost = eventSandbox.postedMessages.find(
    (entry) =>
      (entry.data as { readonly type?: string })?.type === "playlist-stream",
  );

  assert.ok(directStreamPost);

  assert.equal(
    (
      directStreamPost.data as {
        readonly stream?: { readonly mediaUrl?: string };
      }
    ).stream?.mediaUrl,
    "https://assets.example.net/live-event-1.mp4",
  );
});

test("resolves punctuation-sanitized titles, section-scoped duplicate titles, embed SGIDs, tiptap_body posts, and VideoPlayer HTML pages", async () => {
  const courseUrl =
    "https://training.example/c/sample-course/sections/101/lessons/1001";

  const linkedTiptapPostUrl = "https://training.example/c/community/repo-form";

  const linkedPreviewLiveUrl =
    "https://training.example/c/community-events/module-preview";

  const linkedSsrPlayerPostUrl =
    "https://training.example/c/community-events/player-ssr-post";

  const sectionsPayload = {
    records: [
      {
        id: 101,
        name: "Introdução",
        lessons: [
          { id: 1001, name: "Introdução" },
          { id: 1004, name: "Notas, recursos, exemplos" },
        ],
      },
      {
        id: 102,
        name: "Modulo Evolutivo",
        lessons: [
          { id: 1002, name: "Introdução" },
          {
            id: 1005,
            name: "Validação Automatizada — Protegendo Regras de Projeto",
          },
          {
            id: 1006,
            name: "Prévia do Curso: Sistemas Modulares de Exemplo",
          },
          { id: 1007, name: "Aula com Player SSR Linkado" },
        ],
      },
    ],
  };

  const payloadsByPath = new Map<string, Record<string, unknown>>([
    [
      "/internal_api/courses/10/sections/101/lessons/1001",
      {
        id: 1001,
        name: "Introdução",
        featured_media: {
          hls_url: "https://media.example.net/intro-1001/playlist.m3u8",
        },
        rich_text_body: {},
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1002",
      {
        id: 1002,
        name: "Introdução",
        featured_media: {
          hls_url: "https://media.example.net/intro-1002/playlist.m3u8",
        },
        rich_text_body: {},
      },
    ],
    [
      "/internal_api/courses/10/sections/101/lessons/1004",
      {
        id: 1004,
        name: "Notas, recursos, exemplos",
        featured_media: {
          hls_url: "https://media.example.net/1004/playlist.m3u8",
        },
        rich_text_body: {
          sgids_to_object_map: {
            "sgid-form": {
              name: "Formulário Exemplo",
              url: linkedTiptapPostUrl,
            },
          },
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "entity", attrs: { sgid: "sgid-form" } }],
              },
            ],
          },
        },
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1005",
      {
        id: 1005,
        name: "Validação Automatizada — Protegendo Regras de Projeto",
        featured_media: {
          hls_url: "https://media.example.net/1005/playlist.m3u8",
        },
        rich_text_body: {
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Veja ",
                  },
                  {
                    type: "text",
                    text: "Formulario",
                    marks: [
                      { type: "link", attrs: { href: linkedTiptapPostUrl } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1006",
      {
        id: 1006,
        name: "Prévia do Curso: Sistemas Modulares de Exemplo",
        rich_text_body: {
          sgids_to_object_map: {
            "sgid-embed-live": {
              type: "embed",
              title: "Sessões da Comunidade",
              url: linkedPreviewLiveUrl,
            },
          },
          body: {
            type: "doc",
            content: [
              {
                type: "embed",
                attrs: { sgid: "sgid-embed-live" },
              },
            ],
          },
        },
      },
    ],
    [
      "/internal_api/courses/10/sections/102/lessons/1007",
      {
        id: 1007,
        name: "Aula com Player SSR Linkado",
        rich_text_body: {
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Abrir evento",
                    marks: [
                      { type: "link", attrs: { href: linkedSsrPlayerPostUrl } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  ]);

  const ssrPlayerProps = JSON.stringify({
    post: {
      name: "Evento SSR",
      body_trix_content: "<p>Post SSR com player JS.</p>",
    },
  }).replace(/"/g, "&quot;");

  const sandbox = createProbeSandbox({
    pageUrl: courseUrl,
    fetchImpl: async (url) => {
      const target = new URL(String(url));
      const jsonPayload = payloadsByPath.get(target.pathname);

      if (jsonPayload) {
        return new Response(JSON.stringify(jsonPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.pathname === "/internal_api/courses/10/sections") {
        return new Response(JSON.stringify(sectionsPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (target.pathname.endsWith("/repo-form")) {
        return new Response(
          JSON.stringify({
            id: 7431525,
            name: "Formulário Exemplo",
            rich_text_body: null,
            tiptap_body: {
              body: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Preencha o formulário." }],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (target.pathname.endsWith("/module-preview")) {
        return new Response("<html><div>SPA event</div></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      if (target.pathname.endsWith("/player-ssr-post")) {
        return new Response(
          `<html><body><div data-props="${ssrPlayerProps}"></div><div data-component="VideoPlayer"></div></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/courses/10/sections",
  );

  await sandbox.windowObj.fetch(
    "https://training.example/internal_api/courses/10/sections/101/lessons/1001",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  // Verify tiptap_body observation works on community post payloads without rich_text_body.
  const communityTiptapSandbox = createProbeSandbox({
    pageUrl: linkedTiptapPostUrl,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 7431525,
          name: "Formulário Exemplo",
          rich_text_body: null,
          media_settings: {
            video_variants: {
              original: "https://assets.example.net/tiptap-form.mp4",
            },
          },
          tiptap_body: {
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Instruções em tiptap_body." },
                  ],
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await communityTiptapSandbox.windowObj.fetch(
    "https://training.example/internal_api/spaces/501/posts/repo-form",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  assert.ok(
    communityTiptapSandbox.postedMessages.some(
      (entry) =>
        (entry.data as { readonly type?: string })?.type === "playlist-stream",
    ),
  );

  const result = await sandbox.runBatchProbe([
    {
      itemIndex: 0,
      id: "sidebar-lesson-0",
      title: "1.4 Notas recursos exemplos",
      sectionTitle: "1. Introdução",
      url: courseUrl,
    },
    {
      itemIndex: 1,
      id: "sidebar-lesson-1",
      title: "9.1 Introdução",
      sectionTitle: "9. Modulo Evolutivo",
      url: courseUrl,
    },
    {
      itemIndex: 2,
      id: "sidebar-lesson-2",
      title: "10.5 Validação Automatizada - Protegendo Regras de Projeto",
      sectionTitle: "10. Modulo Evolutivo",
      url: courseUrl,
    },
    {
      itemIndex: 3,
      id: "sidebar-lesson-3",
      title: "13.1 Prévia do Curso - Sistemas Modulares de Exemplo",
      sectionTitle: "13. Modulo Evolutivo",
      url: courseUrl,
    },
    {
      itemIndex: 4,
      id: "sidebar-lesson-4",
      title: "14.1 Aula com Player SSR Linkado",
      sectionTitle: "14. Modulo Evolutivo",
      url: courseUrl,
    },
  ]);

  // Duplicate "Introdução" resolves explicitly to section 102 (1002), NOT 1001.
  assert.equal(
    result.discovered.get(1)?.mediaUrl,
    "https://media.example.net/intro-1002/playlist.m3u8",
  );

  // Sanitized titles resolved their real lesson JSON in Tier 1 without falling into sidebar Tier 1.5!
  assert.equal(
    result.partialLessons.get(0)?.mediaUrl,
    "https://media.example.net/1004/playlist.m3u8",
  );

  assert.equal(
    result.partialLessons.get(2)?.mediaUrl,
    "https://media.example.net/1005/playlist.m3u8",
  );

  // Lesson 1006 resolved embed SGID into Markdown + Tier 1.5 linkedUrl.
  assert.deepEqual(fromVmRealm(result.unresolvedIndices), [0, 2, 3, 4]);
  assert.equal(result.unresolvedLinks["3"], linkedPreviewLiveUrl);

  assert.ok(
    result.partialLessons
      .get(3)
      ?.documents?.markdown.includes(linkedPreviewLiveUrl),
  );

  // SSR HTML with data-component="VideoPlayer" does NOT short-circuit to checked: true.
  assert.equal(result.discovered.has(4), false);
  assert.equal(result.unresolvedLinks["4"], linkedSsrPlayerPostUrl);
});
