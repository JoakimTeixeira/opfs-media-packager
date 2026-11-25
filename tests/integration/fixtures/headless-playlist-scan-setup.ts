import {
  type MessageSender,
  EXT_ID,
  EXT_ORIGIN,
  type ApiLesson,
  COURSE_ORIGIN,
  type CourseScanRecord,
} from "./headless-playlist-scan-types.ts";
import {
  realSetTimeout,
  createHarness,
} from "./headless-playlist-scan-harness.ts";

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

export const harness = createHarness();

globalThis.chrome = harness.chromeMock as unknown as typeof chrome;

globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
  harness.mockFetch(url, init)) as unknown as typeof fetch;

await import("../../../background.ts");

export const extSender: MessageSender = Object.freeze({
  id: EXT_ID,
  url: `${EXT_ORIGIN}popup.html`,
  frameId: 0,
});

export function makeApiLessons(count: number): ApiLesson[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(7465 + index),
    url: `${COURSE_ORIGIN}/courses/uuid-1/177/168/${136 + Math.floor(index / 7)}/conteudos?capitulo=${136 + Math.floor(index / 7)}&conteudo=${7465 + index}`,
    fileTitle: `1.${index + 1} Lesson ${index + 1}`,
    folderPath: ["Playlist", "Chapter 1"],
  }));
}

export async function waitForScanReady(
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
