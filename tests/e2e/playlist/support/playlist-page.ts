import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { extensionPath } from "../../support/extension.ts";

export interface PlaylistOutlineLesson {
  readonly url: string;
  readonly folderPath: readonly string[];
}

export interface PlaylistOutlinePayload {
  readonly title: string;
  readonly items: readonly PlaylistOutlineLesson[];
}

export interface RecordedCourseMessage {
  readonly type?: string;
  readonly probeId?: string;
  readonly outline?: PlaylistOutlinePayload;
}

export type RuntimeMessageHandler = (
  message: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response: Record<string, unknown>) => void,
) => void;

export interface MockChromeWindow {
  __recordMessage?: (msg: unknown) => void;
  __childMessage?: (msg: unknown) => void;
  __onMsg?: RuntimeMessageHandler | null;
  chrome?: {
    runtime: {
      sendMessage: (msg: unknown) => Promise<{ ok: boolean }>;
      onMessage: {
        addListener: (fn: RuntimeMessageHandler) => void;
      };
    };
  };
}

export const contentScript = await readFile(
  resolvePath(extensionPath, "dist/content.js"),
  "utf8",
);
