import { type ItemCompanionDocuments } from "../../../lib/item-assets.ts";

export const EXT_ID = "abcdefghijklmnopqrstuvwxzyabcdef";

export const EXT_ORIGIN = `chrome-extension://${EXT_ID}/`;

export const COURSE_ORIGIN = "https://training.example";

export interface MockTab {
  readonly id: number;
  readonly url: string;
  readonly windowId?: number;
  readonly title: string;
}

export interface MockTabCreateOptions {
  readonly url?: string;
  readonly windowId?: number;
  readonly title?: string;
  readonly active?: boolean;
}

export interface CreatedTabRecord extends MockTabCreateOptions {
  readonly id: number;
  readonly url: string;
}

export interface MockWindow {
  readonly id: number;
  readonly state: string;
  readonly tabs: readonly MockTab[];
}

export interface MockWindowCreateOptions {
  readonly url?: string;
  readonly state?: string;
  readonly type?: string;
  readonly focused?: boolean;
}

export interface CreatedWindowRecord extends MockWindowCreateOptions {
  readonly id: number;
  readonly tabId: number;
}

export interface ExecuteScriptDetails {
  readonly target: {
    readonly tabId: number;
    readonly frameIds?: readonly number[];
  };
  readonly files?: readonly string[];
  readonly world?: string;
}

export interface MessageSender {
  readonly id: string;
  readonly url?: string;
  readonly frameId?: number;
  readonly tab?: { readonly id: number };
}

export interface TabMessageOptions {
  readonly frameId?: number;
}

export interface RecordedTabMessage {
  readonly tabId: number;
  readonly message: Record<string, unknown>;
  readonly options: TabMessageOptions;
}

export interface RecordedFetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export interface WebRequestDetails {
  readonly tabId: number;
  readonly frameId: number;
  readonly parentFrameId: number;
  readonly statusCode: number;
  readonly url: string;
}

export interface ApiLesson {
  readonly id: string;
  readonly url: string;
  readonly fileTitle: string;
  readonly folderPath: readonly string[];
  readonly navigationIndex?: number;
}

export interface ProbeLessonTarget {
  readonly itemIndex: number;
  readonly id?: string;
  readonly url?: string;
}

export interface DiscoveredSubtitle {
  readonly url: string;
  readonly language: string;
  readonly label: string;
}

export interface DiscoveredQualityOption {
  readonly url: string;
  readonly label: string;
}

export interface DiscoveredLesson {
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

export interface CourseScanRecord {
  readonly id: string;
  readonly status: string;
  readonly nextItemIndex?: number;
  readonly rateLimited?: boolean;
  readonly discovered: readonly DiscoveredLesson[];
}

export interface CourseDownloadItem {
  readonly itemIndex: number;
}

export interface CourseDownloadRecord {
  readonly sourceTabId?: number | null;
  readonly completedItemIndices?: readonly number[];
  readonly items: readonly CourseDownloadItem[];
}

export interface RuntimeResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly scanId?: string;
  readonly scan?: CourseScanRecord;
  readonly playlistDownload?: CourseDownloadRecord;
}

export type RuntimeMessageListener = (
  message: Record<string, unknown>,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined | void;

export type WebRequestListener = (details: WebRequestDetails) => void;

export type TabRemovedListener = (tabId: number) => void | Promise<void>;

export type TabMessageHandler = (
  tabId: number,
  message: Record<string, unknown>,
  options: TabMessageOptions,
) => Promise<Record<string, unknown>>;

export type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export function probeLessons(
  message: Record<string, unknown>,
): readonly ProbeLessonTarget[] {
  return Array.isArray(message.items)
    ? (message.items as readonly ProbeLessonTarget[])
    : [];
}

export function stringField(
  message: Record<string, unknown>,
  key: string,
): string {
  const value = message[key];

  return typeof value === "string" ? value : "";
}
