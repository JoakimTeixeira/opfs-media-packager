import vm from "node:vm";
import {
  type ProbeSandboxOptions,
  type ProbeSandbox,
  type MessageListener,
  type ProbeWindow,
  FakeXHR,
  compiledProbeScript,
  type ProbeLessonInput,
  type ProbeBatchResult,
  type ProbedStream,
  asProbeMessage,
} from "./page-playlist-probe-environment.ts";

export function createProbeSandbox({
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
