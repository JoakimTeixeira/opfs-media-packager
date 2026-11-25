import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { type ItemCompanionDocuments } from "../../../lib/item-assets.ts";

export interface ProbeLessonInput {
  readonly itemIndex: number;
  readonly id: string;
  readonly title: string;
  readonly sectionTitle?: string;
  readonly url: string;
}

export interface ProbedSubtitle {
  readonly url?: string;
  readonly label?: string;
  readonly language?: string;
}

export interface ProbedStream {
  readonly url?: string;
  readonly mediaUrl?: string;
  readonly linkedTitle?: string;
  readonly subtitles?: readonly ProbedSubtitle[];
  readonly documents?: ItemCompanionDocuments;
}

export interface ProbeBatchResult {
  readonly discovered: Map<number, ProbedStream | null>;
  readonly partialLessons: Map<number, ProbedStream | null>;
  readonly unresolvedIndices: readonly number[];
  readonly unresolvedLinks: Readonly<Record<string, string>>;
  readonly unresolvedLinkLists: Readonly<Record<string, readonly string[]>>;
  readonly rateLimited: boolean;
}

export interface ProbeMessageEvent {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
}

export interface ProbeIncomingMessage {
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

export type MessageListener = (event: ProbeMessageEvent) => void;

export type ProbeFetch = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ProbeSandboxOptions {
  readonly pageUrl?: string;
  readonly fetchImpl: ProbeFetch;
  readonly performanceEntries?: readonly Record<string, unknown>[];
  readonly domProps?: readonly Record<string, unknown>[];
}

export class FakeXHR {
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

export interface ProbeWindow {
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

export interface ProbeSandbox {
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

export const probeSource = await readFile(
  new URL("../../../dist/page-playlist-probe.js", import.meta.url),
  "utf8",
);

export const compiledProbeScript = new vm.Script(probeSource, {
  filename: "page-course-probe.js",
});

export function encodeDeflatedEnvelope(
  payload: Record<string, unknown>,
): string {
  const compressed = deflateSync(Buffer.from(JSON.stringify(payload), "utf8"));

  return JSON.stringify({ content: compressed.toString("base64") });
}

export function asProbeMessage(data: unknown): ProbeIncomingMessage | null {
  return data && typeof data === "object"
    ? (data as ProbeIncomingMessage)
    : null;
}

export function fromVmRealm<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
