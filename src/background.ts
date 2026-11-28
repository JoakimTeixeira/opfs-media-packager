import {
  playlistKind,
  subtitleKind,
  languageLabel,
  languageInUrl,
  languageInName,
  bytesFromBase64,
  base64FromBytes,
  transcriptMetadataFields,
  directQualityOption,
  playlistMetadata,
} from "./background-media.ts";
import { knownSubtitleTracksFromPage } from "../lib/security/page-subtitles.ts";
import { languageInText } from "../lib/subtitles/subtitle-language.ts";
import { decodeSubtitleBytes } from "../lib/subtitles/subtitle-encoding.ts";
import {
  hasSpokenSubtitleCues,
  isStoryboardSubtitleUrl,
  isTranscriptMetadataUrl,
} from "../lib/subtitles/subtitle-tracks.ts";
import {
  countTopicCompanionDocuments,
  inferAttachedDocumentKind,
  isAttachedDocumentKind,
  isExcalidrawUrl,
  isTopicDownloadableForMode,
  mergeTopicCompanionDocuments,
  type TopicFileAsset,
  type TopicLinkAsset,
  type TopicMarkdownNote,
  type TopicCompanionDocuments,
} from "../lib/materials/topic-assets.ts";
import {
  buildPdfFromJpegPages,
  jpegDimensions,
  type PdfJpegPage,
} from "../lib/materials/pdf-builder.ts";
import {
  qualityOptionKey,
  type HlsMasterMetadata,
  type VideoQualityOption,
} from "../lib/media/hls-master.ts";
import {
  numericQualityOptions,
  masterUrlForDetectedPlaylist,
} from "../lib/media/player-adapters.ts";
import {
  usableTrackTopics,
  type TrackTopicInput,
  type UsableTrackTopic,
} from "../lib/track/track-plan.ts";
import { createMediaRequest } from "../lib/media/media-request.ts";
import {
  clampConcurrency,
  DEFAULT_SEGMENT_CONCURRENCY,
} from "../lib/downloads/segments.ts";
import {
  boundedText,
  safeMediaUrl,
  validTabId,
} from "../lib/security/security.ts";
import {
  isTrustedExtensionSender,
  isTrustedTrackSender,
  isTrustedTrackFrameSender,
  validatedDownloadRequest,
  type ValidatedDownloadRequest,
} from "../lib/security/extension-messages.ts";
import {
  externalRecord,
  type ExternalRecord,
  type ExternalValue,
} from "../lib/security/external-values.ts";
import {
  isDirectVideoUrl,
  streamIdentity,
} from "../lib/media/stream-identity.ts";
import { isSupplementaryLinkedPostUrl } from "../lib/materials/linked-video.ts";
import { mergeDetectedStreams } from "../lib/media/stream-collection.ts";
import { playlistMediaAuthorizationRule } from "../lib/media/media-authorization.ts";
import {
  embedPlayerAuthorizationRule,
  normalizeEmbedPlayerUrl,
  parseEmbedPlayerConfig,
  type EmbedAuthorizationRule,
} from "../lib/media/embed-player.ts";
import { isApiTrackPage, isTrackPage } from "../lib/track/track-adapters.ts";
import {
  DEFAULT_DOWNLOAD_PREFERENCES,
  trackDownloadModeOrDefault,
  trackQualityPreferenceOrDefault,
  outputFormatOrDefault,
  subtitleDownloadPreferenceOrDefault,
} from "../lib/downloads/download-preferences.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

type TrackTopic = UsableTrackTopic;

type RuntimeMessageResponse = (response?: unknown) => void;

type RuntimeMessageHandler = (
  message: ExternalRecord,
  sender: chrome.runtime.MessageSender,
  sendResponse: RuntimeMessageResponse,
) => boolean | undefined;

interface SubtitleTrack {
  readonly url: string;
  readonly language: string;
  readonly label: string;
}

type SubtitleCandidate =
  | string
  | {
      readonly url?: unknown;
      readonly webvtt_file_url?: unknown;
      readonly transcript_url?: unknown;
      readonly transcript?: unknown;
      readonly language?: unknown;
      readonly label?: unknown;
    };

interface TopicExtraVideo {
  readonly key: string;
  readonly url: string;
  readonly host: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly kind: "master" | "media" | "direct";
  readonly qualityOptions: readonly VideoQualityOption[];
  readonly subtitles: readonly SubtitleTrack[];
}

interface ProbedStream extends TopicExtraVideo {
  readonly detectedAt: number;
  readonly folderPath?: readonly string[];
  readonly topicIndex?: number;
  readonly linkedTitle?: string;
  readonly primaryVideoTitle?: string;
  readonly extraVideos?: readonly TopicExtraVideo[];
  readonly documents?: TopicCompanionDocuments;
}

interface DiscoveredTopicStream extends ProbedStream {
  readonly folderPath: readonly string[];
  readonly topicIndex: number;
}

interface StoredStreamRecord extends ProbedStream {
  readonly variants?: readonly VideoQualityOption[];
}

interface TabDetectionState {
  pageUrl: string;
  streams: ProbedStream[];
  subtitles: SubtitleTrack[];
  documents?: TopicCompanionDocuments;
}

interface TrackScan {
  readonly id: string;
  readonly title: string;
  readonly items: readonly TrackTopic[];
  readonly discovered: readonly DiscoveredTopicStream[];
  readonly nextTopicIndex: number;
  readonly currentTopicIndex: number | null;
  readonly status: "scanning" | "ready";
  readonly rateLimited?: boolean;
  readonly sourceTabId?: number | null;
  readonly startedAt: number;
}

interface TrackStreamSignal {
  readonly url?: unknown;
  readonly mediaUrl?: unknown;
  readonly embedUrl?: unknown;
  readonly subtitles?: readonly SubtitleCandidate[];
  readonly linkedTitle?: unknown;
  readonly sourceUrl?: unknown;
  readonly documents?: ExternalValue;
}

interface PageMediaResponse {
  readonly status: number;
  readonly body: string;
}

interface PendingPageMediaRequest {
  readonly resolve: (value: PageMediaResponse) => void;
  readonly reject: (reason?: unknown) => void;
  readonly timeout: TimerHandle;
  readonly tabId: number;
}

interface ProbeJob {
  readonly topicIndex: number;
  readonly rawUrl: string;
  readonly embedUrl?: string;
  readonly subtitles: readonly SubtitleCandidate[];
  readonly linkedTitle: string;
  readonly sourceUrl: string;
  readonly documents?: TopicCompanionDocuments;
  readonly partial?: boolean;
}

interface ActiveHeadlessProbe {
  readonly scanId: string;
  readonly tabId: number;
  readonly frameId: number;
  timeout: TimerHandle | null;
  readonly onTopic: (
    topicIndex: number,
    stream: TrackStreamSignal | null,
    partial?: boolean,
  ) => void;
  readonly onDone: (
    unresolvedIndices: readonly unknown[],
    unresolvedLinks?: ExternalRecord,
    rateLimited?: boolean,
    unresolvedLinkLists?: ExternalRecord,
  ) => void;
}

interface TrackProbeAttemptResult {
  readonly ok: boolean;
  readonly needsInject: boolean;
  readonly rateLimited: boolean;
  readonly unresolvedIndices: number[];
  readonly unresolvedLinks: Record<string, string>;
  readonly unresolvedLinkLists: Record<string, readonly string[]>;
}

interface TrackProbeResult {
  readonly ok: boolean;
  readonly rateLimited: boolean;
  readonly unresolvedIndices: number[];
  readonly unresolvedLinks: Record<string, string>;
  readonly unresolvedLinkLists: Record<string, readonly string[]>;
}

interface PendingHiddenFrame {
  readonly tabId: number;
  readonly origin: string;
  readonly resolve: (frameId: number | null) => void;
}

interface HiddenFrameProbe {
  readonly scanId: string;
  readonly topicIndex: number;
  readonly sourceUrl: string;
  readonly topicTitle: string;
  readonly ruleId: number;
  readonly onStream: (stream: ProbedStream) => void;
  readonly onSubtitles: (tracks: readonly SubtitleTrack[]) => void;
}

interface HiddenFrameHandle {
  readonly probeId: string;
  readonly frameId: number;
}

interface HiddenFrameTopicOutcome {
  readonly captured: boolean;
  readonly streamKey: string;
  readonly linkedUrl?: string;
}

interface HiddenFrameObservationOptions {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly frameId: number;
  readonly topicIndex: number;
  readonly item: TrackTopic;
  readonly targetUrl: string;
  readonly isLinkedVideo: boolean;
  readonly previousStreamKey: string;
  readonly initialTimeoutMs?: number;
  readonly deferCountChecked?: boolean;
  readonly appendDistinctVideo?: boolean;
  readonly linkedPostMode?: boolean;
}

interface FinalizeHiddenFrameContext extends HiddenFrameObservationOptions {
  readonly slotRuleId: number;
  readonly capturedStream: ProbedStream | null;
  readonly subtitles: readonly SubtitleTrack[];
}

interface OpenHiddenIframeOptions {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly topicIndex: number;
  readonly item: TrackTopic;
  readonly targetUrl: string;
  readonly isLinkedVideo: boolean;
  readonly navigateSidebar?: boolean;
  readonly previousStreamKey?: string;
  readonly deferCountChecked?: boolean;
  readonly appendDistinctVideo?: boolean;
  readonly linkedPostMode?: boolean;
}

interface StepSidebarTopicInput {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly sourceOrigin: string;
  readonly primaryFrame: HiddenFrameHandle;
  readonly topicIndex: number;
  readonly item: TrackTopic;
  readonly linkedUrls: readonly string[];
  readonly previousStreamKey: string;
}

interface StepSidebarTopicsContext {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly sourceOrigin: string;
  readonly scan: TrackScan;
  readonly primaryFrame: HiddenFrameHandle;
  readonly topicIndices: readonly number[];
  readonly unresolvedLinks: Readonly<Record<string, string>>;
  readonly unresolvedLinkLists: Readonly<Record<string, readonly string[]>>;
  readonly initialStreamKey: string;
}

interface ParallelHiddenIframeContext {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly scan: TrackScan;
  readonly topicIndices: readonly number[];
  readonly unresolvedLinks: Readonly<Record<string, string>>;
  readonly unresolvedLinkLists: Readonly<Record<string, readonly string[]>>;
}

interface HiddenIframeScanResult {
  readonly remaining: number[];
  readonly unresolvedLinks: Record<string, string>;
  readonly rateLimited?: boolean;
}

interface WorkerTabProbe {
  readonly scanId: string;
  readonly workerWindowId: number | null;
  readonly playlistUrl: string;
  readonly unresolvedLinks: Record<string, string>;
  readonly queue: readonly number[];
  readonly queuePos: number;
  readonly topicIndex: number;
  readonly navigationIndex: number | null;
  readonly topicTitle: string;
  readonly topicSection: string;
  readonly linkedTitle: string;
  readonly navigated: boolean;
  readonly navigationStarted: boolean;
  readonly followedLinkedVideo: boolean;
  readonly previousStreamKey: string;
  readonly lastStreamKey: string;
  readonly streamCaptured: boolean;
  readonly hasSubtitles: boolean;
  readonly pendingSubtitles: readonly SubtitleTrack[];
  readonly triedApiEscalation: boolean;
  readonly fanoutStarted: boolean;
  readonly isSidebarButtons: boolean;
}

const stateKey = (tabId: number): string => `detections:${tabId}`;
const outlineKey = (tabId: number): string => `track-outline:${tabId}`;
const playlistKey = (scanId: string): string => `track-scan:${scanId}`;
const probeKey = (tabId: number): string => `track-probe:${tabId}`;
const mediaAuthorizationRuleId = 910001;
const pageMediaRequests = new Map<string, PendingPageMediaRequest>();
const pendingDownloadTargets = new Map<string, string>();
const scanWriteQueues = new Map<string, Promise<TrackScan | null>>();
const activeHeadlessProbes = new Map<string, ActiveHeadlessProbe>();
const workerEarlyExitTimers = new Map<number, TimerHandle>();
const activeScanWorkerTabs = new Map<string, Set<number>>();
const pendingHiddenFrameReady = new Map<string, PendingHiddenFrame>();
const hiddenFrameProbes = new Map<string, HiddenFrameProbe>();
const DIAGRAM_FRAME_PREFIX = "opfs-media-packager-diagram-frame:";
const SLIDES_FRAME_PREFIX = "opfs-media-packager-slides-frame:";

const readyExportFrames = new Map<
  string,
  {
    readonly tabId: number;
    readonly frameId: number;
    readonly recordedAt: number;
  }
>();

const pendingExportFrames = new Map<
  string,
  {
    readonly tabId: number;
    readonly timer: TimerHandle;
    readonly resolve: (frameId: number | null) => void;
  }
>();

const INSPECT_CONCURRENCY = 10;
const WORKER_TAB_CONCURRENCY = 4;
const HIDDEN_IFRAME_CONCURRENCY = 3;

const workerRuntime: {
  nextAuthorizationSlot: number;
  detectionQueue: Promise<void>;
} = {
  nextAuthorizationSlot: 0,
  detectionQueue: Promise.resolve(),
};

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function enqueueDetection<T>(task: () => Promise<T>): Promise<T> {
  const result = workerRuntime.detectionQueue.then(task);

  workerRuntime.detectionQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

function errorMessage(error: unknown, fallback = ""): string {
  if (error instanceof Error && error.message) return error.message;
  const record = externalRecord(error);

  return typeof record?.message === "string" && record.message
    ? record.message
    : fallback;
}

// A playlist probe is one hidden tab used to open a item and observe its video
// request without interrupting the tab where the viewer is studying.

function isOwnBlobUrl(
  value: ExternalValue,
  expectedOrigin: string,
): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);

    return (
      url.protocol === "blob:" && url.origin === new URL(expectedOrigin).origin
    );
  } catch {
    return false;
  }
}

function isAllowedDownloadTargetUrl(
  value: ExternalValue,
  expectedOrigin: string,
): value is string {
  if (isOwnBlobUrl(value, expectedOrigin)) return true;
  const safe = safeMediaUrl(value);

  return Boolean(safe && isDirectVideoUrl(safe));
}

function isSafeDownloadTarget(value: ExternalValue): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

async function fetchFromTrackPage(
  tabId: number,
  url: string,
  responseType: "text" | "bytes",
  timeoutMs = 30000,
): Promise<PageMediaResponse> {
  const safeUrl = safeMediaUrl(url);
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  if (!safeUrl || !isTrackPage(tab?.url)) {
    throw new Error("The signed-in track tab is no longer available.");
  }

  const requestId = crypto.randomUUID();

  return new Promise<PageMediaResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pageMediaRequests.delete(requestId);
      reject(new Error("The signed-in track tab did not respond."));
    }, timeoutMs);

    pageMediaRequests.set(requestId, { resolve, reject, timeout, tabId });

    chrome.tabs
      .sendMessage(
        tabId,
        {
          type: "fetch-media-from-page",
          requestId,
          responseType,
          url: safeUrl,
        },
        { frameId: 0 },
      )
      .catch((error: unknown) => {
        clearTimeout(timeout);
        pageMediaRequests.delete(requestId);
        reject(error);
      });
  });
}

function hasSubtitleCues(text: string): boolean {
  return hasSpokenSubtitleCues(text);
}

interface InspectedSubtitle {
  readonly language: string;
  readonly resolvedUrl?: string;
}

async function fetchSubtitleText(
  safeUrl: string,
  sourceUrl: string,
  sourceTabId: number | null = null,
): Promise<string> {
  const response = await fetchMediaResponse(safeUrl, sourceUrl, "GET");

  if (response?.ok) {
    return decodeSubtitleBytes(new Uint8Array(await response.arrayBuffer()));
  }

  if (!validTabId(sourceTabId) || !isTrackPage(sourceUrl)) return "";

  const pageResponse = await fetchFromTrackPage(
    sourceTabId,
    safeUrl,
    "bytes",
    4000,
  ).catch(() => null);

  if (
    !pageResponse ||
    pageResponse.status < 200 ||
    pageResponse.status >= 300 ||
    !pageResponse.body
  ) {
    return "";
  }

  try {
    return decodeSubtitleBytes(bytesFromBase64(pageResponse.body));
  } catch {
    return "";
  }
}

async function inspectTranscriptEndpoint(
  safeUrl: string,
  content: string,
  fallbackText: string,
  sourceUrl: string,
  sourceTabId: number | null,
): Promise<InspectedSubtitle | null> {
  const meta = transcriptMetadataFields(content);

  if (
    !meta?.resolvedUrl ||
    meta.resolvedUrl === safeUrl ||
    isStoryboardSubtitleUrl(meta.resolvedUrl)
  ) {
    return null;
  }

  if (meta.language) {
    return { language: meta.language, resolvedUrl: meta.resolvedUrl };
  }

  const target = await inspectSubtitle(
    meta.resolvedUrl,
    fallbackText,
    sourceUrl,
    sourceTabId,
  );

  return target ? { ...target, resolvedUrl: meta.resolvedUrl } : null;
}

async function inspectSubtitle(
  url: string,
  fallbackText = "",
  sourceUrl = "",
  sourceTabId: number | null = null,
): Promise<InspectedSubtitle | null> {
  const safeUrl = safeMediaUrl(url);

  if (!safeUrl || isStoryboardSubtitleUrl(safeUrl)) return null;
  const fromUrl = languageInUrl(safeUrl);
  const fallbackLanguage = languageInText(fallbackText);
  const content = await fetchSubtitleText(safeUrl, sourceUrl, sourceTabId);

  if (!content) return { language: fromUrl || fallbackLanguage || "Subtitle" };

  if (isTranscriptMetadataUrl(safeUrl) && content.trimStart().startsWith("{")) {
    return inspectTranscriptEndpoint(
      safeUrl,
      content,
      fallbackText,
      sourceUrl,
      sourceTabId,
    );
  }

  if (!hasSubtitleCues(content)) return null;

  const language =
    fromUrl || languageInText(content) || fallbackLanguage || "Subtitle";

  return { language };
}

function rawStoredStreams(value: ExternalRecord | null): unknown[] {
  if (Array.isArray(value?.streams)) return value.streams;
  if (Array.isArray(value?.videos)) return value.videos;

  return [];
}

async function getState(tabId: number): Promise<TabDetectionState> {
  const stored = await chrome.storage.session.get(stateKey(tabId));
  const value = stored[stateKey(tabId)];

  if (Array.isArray(value)) {
    return {
      pageUrl: "",
      streams: currentStreamState(value),
      subtitles: [],
    };
  }

  const record = externalRecord(value);
  const documents = validatedDocumentsRecord(record?.documents);

  return {
    pageUrl: typeof record?.pageUrl === "string" ? record.pageUrl : "",
    streams: currentStreamState(rawStoredStreams(record)),
    subtitles: Array.isArray(record?.subtitles)
      ? (record.subtitles as SubtitleTrack[])
      : [],
    ...(documents ? { documents } : {}),
  };
}

/**
 * Reads saved stream records into the current shape. The `variants` property
 * was written by earlier releases for the same list of video quality choices.
 */
function currentStreamState(storedStreams: readonly unknown[]): ProbedStream[] {
  return storedStreams.map((storedStream) => {
    const stream = storedStream as StoredStreamRecord;
    const { variants: earlierQualityOptions, ...currentStream } = stream;

    return {
      ...currentStream,
      qualityOptions: stream.qualityOptions || earlierQualityOptions || [],
    };
  });
}

async function synchronizePageState(
  tabId: number,
  pageUrl: string,
): Promise<TabDetectionState> {
  const state = await getState(tabId);

  if (!pageUrl || state.pageUrl === pageUrl) return state;

  if (!state.pageUrl) {
    const boundState: TabDetectionState = { ...state, pageUrl };

    await setState(tabId, boundState);

    return boundState;
  }

  const freshState: TabDetectionState = { pageUrl, streams: [], subtitles: [] };

  await chrome.storage.session.remove(outlineKey(tabId));
  await setState(tabId, freshState);

  return freshState;
}

async function setState(
  tabId: number,
  state: TabDetectionState,
): Promise<void> {
  await chrome.storage.session.set({ [stateKey(tabId)]: state });

  await chrome.action.setBadgeText({
    tabId,
    text: state.streams.length ? String(state.streams.length) : "",
  });

  if (state.streams.length) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  }
}

function toMutableSessionRule(
  rule: EmbedAuthorizationRule,
  ruleId: number,
): chrome.declarativeNetRequest.Rule {
  return {
    ...rule,
    id: ruleId,
    action: {
      ...rule.action,
      requestHeaders: rule.action.requestHeaders.map((header) => ({
        ...header,
      })),
    },
    condition: {
      ...rule.condition,
      resourceTypes: [...rule.condition.resourceTypes],
    },
  };
}

async function authorizeMediaUrl(
  mediaUrl: string,
  sourceUrl: string,
  ruleId = mediaAuthorizationRuleId,
): Promise<void> {
  const rule = playlistMediaAuthorizationRule(
    mediaUrl,
    sourceUrl,
    chrome.runtime.id,
  );

  const sessionRule = rule ? toMutableSessionRule(rule, ruleId) : null;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    ...(sessionRule ? { addRules: [sessionRule] } : {}),
  });
}

async function authorizeDownloadMedia(download: {
  readonly url: string;
  readonly sourceUrl?: string;
}): Promise<void> {
  await authorizeMediaUrl(download.url, download.sourceUrl || "");
}

function uniqueQualityOptions(
  qualityOptions: readonly VideoQualityOption[],
): VideoQualityOption[] {
  return qualityOptions
    .filter(
      (qualityOption, index, all) =>
        all.findIndex(
          (item) => qualityOptionKey(item) === qualityOptionKey(qualityOption),
        ) === index,
    )
    .sort(
      (left, right) =>
        Number.parseInt(right.label, 10) - Number.parseInt(left.label, 10),
    );
}

/**
 * Refreshes saved master URLs and recovers quality options for any detected
 * stream whose initial playlist inspection returned an empty quality list.
 */
async function refreshStoredQualityOptions(
  tabId: number,
): Promise<TabDetectionState> {
  const state = await getState(tabId);

  const streams = await Promise.all(
    state.streams.map(async (stream): Promise<ProbedStream> => {
      const adjacentMaster = masterUrlForDetectedPlaylist(stream.url);
      const missingQualities = stream.qualityOptions.length === 0;

      if (
        !missingQualities &&
        (!adjacentMaster || adjacentMaster === stream.url)
      ) {
        return stream;
      }

      const sourceUrl = state.pageUrl || stream.sourceUrl;

      try {
        const { playlistUrl, metadata } = await inspectAuthorizedPlaylist(
          stream.url,
          sourceUrl,
          mediaAuthorizationRuleId,
          tabId,
        );

        const probedOptions =
          metadata.isMaster && metadata.qualityOptions.length
            ? []
            : await findAvailableQualityOptions(playlistUrl, sourceUrl);

        const nextOptions = uniqueQualityOptions([
          ...metadata.qualityOptions,
          ...stream.qualityOptions,
          ...probedOptions,
        ]);

        if (
          !metadata.isMaster &&
          nextOptions.length === stream.qualityOptions.length
        ) {
          return stream;
        }

        return {
          ...stream,
          url: metadata.isMaster ? playlistUrl : stream.url,
          kind: metadata.isMaster ? "master" : stream.kind,
          qualityOptions: nextOptions,
          subtitles: [...stream.subtitles, ...metadata.subtitles].filter(
            (track, index, all) =>
              all.findIndex((item) => item.url === track.url) === index,
          ),
        };
      } catch {
        return stream;
      }
    }),
  );

  const mergedStreams = mergeDetectedStreams(streams);

  if (
    streams.every((stream, index) => stream === state.streams[index]) &&
    mergedStreams.length === state.streams.length
  ) {
    return state;
  }

  const refreshedState: TabDetectionState = {
    ...state,
    streams: mergedStreams,
  };

  await setState(tabId, refreshedState);

  return refreshedState;
}

async function getTrackScan(scanId: string): Promise<TrackScan | null> {
  const stored = await chrome.storage.session.get(playlistKey(scanId));

  return (stored[playlistKey(scanId)] as TrackScan | undefined) || null;
}

async function setTrackScan(scan: TrackScan): Promise<void> {
  await chrome.storage.session.set({ [playlistKey(scan.id)]: scan });
}

async function getTabProbe(tabId: number): Promise<WorkerTabProbe | null> {
  const stored = await chrome.storage.session.get(probeKey(tabId));

  return (stored[probeKey(tabId)] as WorkerTabProbe | undefined) || null;
}

/**
 * Serializes immutable updates to one TrackScan so parallel headless workers
 * never overwrite each other's discovered items.
 */
function updateTrackScan(
  scanId: string,
  transform: (scan: TrackScan) => TrackScan | null,
): Promise<TrackScan | null> {
  const previous =
    scanWriteQueues.get(scanId) || Promise.resolve<TrackScan | null>(null);

  const next = previous
    .catch(() => null)
    .then(async (): Promise<TrackScan | null> => {
      const scan = await getTrackScan(scanId);

      if (!scan) return null;
      const updated = transform(scan);

      if (!updated) return scan;
      await setTrackScan(updated);

      return updated;
    });

  scanWriteQueues.set(scanId, next);

  return next;
}

function incrementCheckedTopicCount(scanId: string): Promise<TrackScan | null> {
  return updateTrackScan(scanId, (current) =>
    Object.freeze({
      ...current,
      nextTopicIndex: Math.min(
        current.items.length,
        current.nextTopicIndex + 1,
      ),
    }),
  );
}

function markTrackScanReady(
  scanId: string,
  rateLimited = false,
): Promise<TrackScan | null> {
  return updateTrackScan(scanId, (current) =>
    Object.freeze({
      ...current,
      status: "ready" as const,
      rateLimited: Boolean(rateLimited),
      nextTopicIndex: current.items.length,
      currentTopicIndex: null,
    }),
  );
}

function uniqueSubtitles(tracks: readonly SubtitleTrack[]): SubtitleTrack[] {
  return tracks.filter(
    (track, index, all) =>
      Boolean(track?.url) &&
      all.findIndex((other) => other.url === track.url) === index,
  );
}

/**
 * Inspects either the adjacent master manifest or the detected manifest URL,
 * falling back to the detected URL itself when no sibling `playlist.m3u8` exists.
 */
async function inspectAuthorizedPlaylist(
  candidateUrl: string,
  sourceUrl: string,
  ruleId = mediaAuthorizationRuleId,
  sourceTabId: number | null = null,
): Promise<{
  readonly playlistUrl: string;
  readonly metadata: HlsMasterMetadata;
}> {
  const masterUrl = masterUrlForDetectedPlaylist(candidateUrl);

  const targets =
    masterUrl && masterUrl !== candidateUrl
      ? [masterUrl, candidateUrl]
      : [candidateUrl];

  for (const targetUrl of targets) {
    await authorizeMediaUrl(targetUrl, sourceUrl, ruleId).catch(() => {});

    try {
      const metadata = await inspectPlaylist(targetUrl, sourceUrl);

      if (metadata.isMaster || targetUrl === candidateUrl) {
        return Object.freeze({ playlistUrl: targetUrl, metadata });
      }
    } catch {
      // Fall back to the detected manifest URL before giving up.
    }
  }

  if (validTabId(sourceTabId) && isTrackPage(sourceUrl)) {
    try {
      const metadata = await inspectPlaylist(
        candidateUrl,
        sourceUrl,
        sourceTabId,
      );

      return Object.freeze({ playlistUrl: candidateUrl, metadata });
    } catch {
      // Fall back to empty metadata when the signed-in tab cannot fetch it either.
    }
  }

  return Object.freeze({
    playlistUrl: candidateUrl,
    metadata: Object.freeze({
      isMaster: false,
      qualityOptions: Object.freeze([]),
      subtitles: Object.freeze([]),
    }),
  });
}

function candidateSubtitleRawUrl(candidate: SubtitleCandidate): unknown {
  if (typeof candidate === "string") return candidate;

  return (
    candidate?.url ??
    candidate?.webvtt_file_url ??
    candidate?.transcript_url ??
    candidate?.transcript
  );
}

async function resolveExtraSubtitle(
  candidate: SubtitleCandidate,
  sourceUrl: string,
  fallbackText = "",
  sourceTabId: number | null = null,
): Promise<SubtitleTrack | null> {
  const safeSubUrl = safeMediaUrl(candidateSubtitleRawUrl(candidate));

  if (!safeSubUrl || isStoryboardSubtitleUrl(safeSubUrl)) return null;

  const candidateLang =
    typeof candidate === "object" && typeof candidate?.language === "string"
      ? languageLabel(candidate.language) || languageInName(candidate.language)
      : "";

  const candidateLabel =
    typeof candidate === "object" && typeof candidate?.label === "string"
      ? boundedText(candidate.label, 160)
      : "";

  const knownLanguage =
    candidateLang ||
    languageInName(candidateLabel) ||
    languageInUrl(safeSubUrl);

  const inspected =
    knownLanguage && !isTranscriptMetadataUrl(safeSubUrl)
      ? { language: knownLanguage }
      : await inspectSubtitle(safeSubUrl, fallbackText, sourceUrl, sourceTabId);

  if (!inspected) return null;

  const resolvedUrl = inspected.resolvedUrl || safeSubUrl;

  return Object.freeze({
    url: resolvedUrl,
    label:
      candidateLabel ||
      new URL(resolvedUrl).pathname.split("/").pop() ||
      "Subtitle",
    language: knownLanguage || inspected.language || "Subtitle",
  });
}

async function resolveExtraSubtitleList(
  extraSubtitleUrls: readonly SubtitleCandidate[],
  sourceUrl: string,
  fallbackText: string,
  sourceTabId: number | null,
): Promise<SubtitleTrack[]> {
  if (!extraSubtitleUrls.length) return [];

  const resolved = await Promise.all(
    extraSubtitleUrls.map((candidate) =>
      resolveExtraSubtitle(candidate, sourceUrl, fallbackText, sourceTabId),
    ),
  );

  return resolved.filter(isPresent);
}

/**
 * Normalizes a raw stream URL (playlist, direct video, or directory) into a
 * full ProbedStream by inspecting its HLS master/variants and known subtitles.
 */
async function buildProbedStream(
  rawUrl: string,
  sourceUrl: string,
  extraSubtitleUrls: readonly SubtitleCandidate[] = [],
  ruleId = mediaAuthorizationRuleId,
  fallbackText = "",
  sourceTabId: number | null = null,
): Promise<ProbedStream | null> {
  const safeBase = safeMediaUrl(rawUrl);

  if (!safeBase) return null;

  if (isDirectVideoUrl(safeBase)) {
    const extraSubtitles = await resolveExtraSubtitleList(
      extraSubtitleUrls,
      sourceUrl,
      fallbackText,
      sourceTabId,
    );

    return Object.freeze({
      key: streamIdentity(safeBase) || safeBase,
      url: safeBase,
      host: new URL(safeBase).host,
      title: "Track stream",
      sourceUrl,
      kind: "direct" as const,
      qualityOptions: Object.freeze([
        Object.freeze({ url: safeBase, label: "Original MP4" }),
      ]),
      subtitles: uniqueSubtitles(extraSubtitles),
      detectedAt: Date.now(),
    });
  }

  const base = safeBase.replace(/\/$/, "");

  const candidateUrl = /\.m3u8?(?:$|[?#])/i.test(base)
    ? base
    : `${base}/playlist.m3u8`;

  const { playlistUrl, metadata } = await inspectAuthorizedPlaylist(
    candidateUrl,
    sourceUrl,
    ruleId,
    sourceTabId,
  );

  const detectedQualityOption = metadata.isMaster
    ? null
    : directQualityOption(candidateUrl);

  const playerQualityOptions =
    metadata.isMaster && metadata.qualityOptions.length
      ? []
      : await findAvailableQualityOptions(playlistUrl, sourceUrl);

  const qualityOptions = uniqueQualityOptions(
    [
      ...metadata.qualityOptions,
      detectedQualityOption,
      ...playerQualityOptions,
    ].filter(isPresent),
  );

  const extraSubtitles = await resolveExtraSubtitleList(
    extraSubtitleUrls,
    sourceUrl,
    fallbackText,
    sourceTabId,
  );

  return Object.freeze({
    key: streamIdentity(playlistUrl) || playlistUrl,
    url: playlistUrl,
    host: new URL(playlistUrl).host,
    title: "Track stream",
    sourceUrl,
    kind: metadata.isMaster ? ("master" as const) : ("media" as const),
    qualityOptions,
    subtitles: uniqueSubtitles([...metadata.subtitles, ...extraSubtitles]),
    detectedAt: Date.now(),
  });
}

function validatedFileAssetEntries(
  value: ExternalValue,
  defaultFilename: string,
  resolveKind: (
    record: ExternalRecord,
    filename: string,
    contentType: string,
  ) => TopicFileAsset["kind"],
): readonly TopicFileAsset[] {
  if (!Array.isArray(value)) return Object.freeze([]);

  return Object.freeze(
    value.slice(0, 100).flatMap((entry): TopicFileAsset[] => {
      const record = externalRecord(entry);
      const url = safeMediaUrl(record?.url);

      if (!record || !url) return [];
      const fallbackUrl = safeMediaUrl(record.fallbackUrl);

      const filename =
        boundedText(record.filename, 200).trim() || defaultFilename;

      const contentType = boundedText(record.contentType, 120).trim();
      const kind = resolveKind(record, filename, contentType);

      return [
        Object.freeze({
          kind,
          url,
          ...(fallbackUrl ? { fallbackUrl } : {}),
          filename,
          ...(contentType ? { contentType } : {}),
        }),
      ];
    }),
  );
}

function validatedAttachedFileAssets(
  value: ExternalValue,
): readonly TopicFileAsset[] {
  return validatedFileAssetEntries(
    value,
    "document.bin",
    (record, filename, contentType) =>
      isAttachedDocumentKind(record.kind)
        ? record.kind
        : inferAttachedDocumentKind(filename, contentType),
  );
}

function validatedFileAssets(
  value: ExternalValue,
  kind: "image" | "pdf",
): readonly TopicFileAsset[] {
  return validatedFileAssetEntries(
    value,
    kind === "pdf" ? "document.pdf" : "image.png",
    () => kind,
  );
}

function validatedLinkAssets(
  value: ExternalValue,
  kind: "diagram" | "slides",
): readonly TopicLinkAsset[] {
  if (!Array.isArray(value)) return Object.freeze([]);

  const defaultTitle = kind === "diagram" ? "Excalidraw diagram" : "Slides";

  return Object.freeze(
    value.slice(0, 100).flatMap((entry): TopicLinkAsset[] => {
      const record = externalRecord(entry);
      const url = safeMediaUrl(record?.url);

      if (!record || !url) return [];
      const title = boundedText(record.title, 200).trim() || defaultTitle;

      return [Object.freeze({ kind, url, title })];
    }),
  );
}

function validatedExtraNotes(
  value: ExternalValue,
): readonly TopicMarkdownNote[] {
  if (!Array.isArray(value)) return Object.freeze([]);

  return Object.freeze(
    value.slice(0, 20).flatMap((entry): TopicMarkdownNote[] => {
      const record = externalRecord(entry);

      const markdown =
        typeof record?.markdown === "string" && record.markdown.trim()
          ? boundedText(record.markdown, 500000)
          : "";

      if (!record || !markdown) return [];
      const title = boundedText(record.title, 240).trim() || "Linked note";
      const sourceUrl = safeMediaUrl(record.sourceUrl);

      return [
        Object.freeze({
          title,
          markdown,
          ...(sourceUrl ? { sourceUrl } : {}),
        }),
      ];
    }),
  );
}

function validatedDocumentsRecord(
  value: ExternalValue,
): TopicCompanionDocuments | undefined {
  const record = externalRecord(value);

  if (!record) return undefined;

  const markdown =
    typeof record.markdown === "string" && record.markdown.trim()
      ? boundedText(record.markdown, 500000)
      : "";

  const extraNotes = validatedExtraNotes(record.extraNotes);
  const files = validatedAttachedFileAssets(record.files);

  const documents: TopicCompanionDocuments = Object.freeze({
    markdown,
    images: validatedFileAssets(record.images, "image"),
    pdfs: validatedFileAssets(record.pdfs, "pdf"),
    ...(files.length ? { files } : {}),
    diagrams: validatedLinkAssets(record.diagrams, "diagram"),
    slides: validatedLinkAssets(record.slides, "slides"),
    ...(extraNotes.length ? { extraNotes } : {}),
  });

  return countTopicCompanionDocuments(documents) > 0 ? documents : undefined;
}

function documentsOnlyStream(
  topicIndex: number,
  sourceUrl: string,
  documents: TopicCompanionDocuments,
  linkedTitle = "",
): ProbedStream {
  return Object.freeze({
    key: `documents:${topicIndex}`,
    url: "",
    host: "",
    title: "Topic documents",
    sourceUrl,
    kind: "media" as const,
    qualityOptions: Object.freeze([]),
    subtitles: Object.freeze([]),
    detectedAt: Date.now(),
    ...(linkedTitle ? { linkedTitle } : {}),
    documents,
  });
}

async function extractFrameDocuments(
  tabId: number,
  frameId = 0,
): Promise<TopicCompanionDocuments | undefined> {
  const response = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, { type: "extract-topic-documents" }, { frameId })
      .catch(() => null),
  );

  return validatedDocumentsRecord(response?.documents);
}

function cleanLinkedTitle(rawTitle: string): string {
  const cleaned = boundedText(rawTitle, 240).replace(/\s+/g, " ").trim();

  if (!cleaned) return "";

  return cleaned.replace(/\s+[|·]\s+[^|·]{2,60}$/, "").trim() || cleaned;
}

/**
 * Combines a item's numeric order prefix (e.g. "3.8 ") with a linked video's
 * own title when the item points to an external/linked video post.
 */
function resolvedTopicTitle(
  topicFileTitle: string,
  linkedTitle?: string,
): string {
  const cleanedLinked = cleanLinkedTitle(linkedTitle || "");

  if (!cleanedLinked) return topicFileTitle;
  const prefix = /^(\d+\.\d+\s+)/.exec(topicFileTitle)?.[1] || "";

  return `${prefix}${cleanedLinked}`;
}

function toExtraVideoEntry(
  stream: ProbedStream,
  title: string,
): TopicExtraVideo {
  return Object.freeze({
    key: stream.key,
    url: stream.url,
    host: stream.host,
    title,
    sourceUrl: stream.sourceUrl,
    kind: stream.kind,
    qualityOptions: stream.qualityOptions,
    subtitles: stream.subtitles,
  });
}

function appendUniqueExtraVideo(
  existing: readonly TopicExtraVideo[],
  incoming: ProbedStream,
  incomingTitle: string,
  primaryIdentity: string,
): readonly TopicExtraVideo[] {
  const incomingIdentity = streamIdentity(incoming.url) || incoming.key;

  if (!incoming.url || incomingIdentity === primaryIdentity) return existing;

  if (
    existing.some(
      (video) => (streamIdentity(video.url) || video.key) === incomingIdentity,
    )
  ) {
    return existing;
  }

  return Object.freeze([
    ...existing,
    toExtraVideoEntry(incoming, incomingTitle),
  ]);
}

function mergeDistinctExtraVideoStream(
  current: ProbedStream,
  incoming: ProbedStream,
  documents: TopicCompanionDocuments | undefined,
  primaryIdentity: string,
  options: {
    readonly primaryTitleForSplit?: string;
    readonly incomingVideoTitle?: string;
  },
): ProbedStream {
  const nextExtraVideos = appendUniqueExtraVideo(
    current.extraVideos || [],
    incoming,
    options.incomingVideoTitle || incoming.title,
    primaryIdentity,
  );

  const primaryVideoTitle =
    current.primaryVideoTitle || options.primaryTitleForSplit;

  return Object.freeze({
    ...current,
    ...(primaryVideoTitle ? { primaryVideoTitle } : {}),
    extraVideos: nextExtraVideos,
    ...(documents ? { documents } : {}),
  });
}

function mergeCapturedStream(
  current: ProbedStream | null,
  incoming: ProbedStream,
  options?: {
    readonly appendDistinctVideo?: boolean;
    readonly secondaryAsExtraNote?: {
      readonly title: string;
      readonly sourceUrl?: string;
    };
    readonly primaryTitleForSplit?: string;
    readonly incomingVideoTitle?: string;
  },
): ProbedStream {
  if (!current) return incoming;

  const documents = mergeTopicCompanionDocuments(
    current.documents,
    incoming.documents,
    options?.secondaryAsExtraNote
      ? { secondaryAsExtraNote: options.secondaryAsExtraNote }
      : undefined,
  );

  const primaryIdentity = current.url
    ? streamIdentity(current.url) || current.key
    : "";

  const incomingIdentity = incoming.url
    ? streamIdentity(incoming.url) || incoming.key
    : "";

  if (
    options?.appendDistinctVideo &&
    primaryIdentity &&
    incomingIdentity &&
    incomingIdentity !== primaryIdentity
  ) {
    return mergeDistinctExtraVideoStream(
      current,
      incoming,
      documents,
      primaryIdentity,
      options,
    );
  }

  const preferIncoming =
    Boolean(incoming.url) &&
    (!current.url ||
      (incoming.kind === "master" && current.kind !== "master") ||
      incoming.qualityOptions.length > current.qualityOptions.length);

  const base = preferIncoming ? incoming : current;

  const isMaster = current.kind === "master" || incoming.kind === "master";

  return Object.freeze({
    ...base,
    kind: isMaster ? ("master" as const) : base.kind,
    qualityOptions: uniqueQualityOptions([
      ...current.qualityOptions,
      ...incoming.qualityOptions,
    ]),
    subtitles: uniqueSubtitles([...current.subtitles, ...incoming.subtitles]),
    ...(current.primaryVideoTitle
      ? { primaryVideoTitle: current.primaryVideoTitle }
      : {}),
    ...(current.extraVideos?.length
      ? { extraVideos: current.extraVideos }
      : {}),
    ...(documents ? { documents } : {}),
  });
}

function resolvedEntryTitle(
  topicFileTitle: string,
  previousTitle: string | undefined,
  streamLinkedTitle: string | undefined,
  hasExtraVideos: boolean,
): string {
  if (hasExtraVideos) return topicFileTitle;

  if (streamLinkedTitle) {
    return resolvedTopicTitle(topicFileTitle, streamLinkedTitle);
  }

  return previousTitle || topicFileTitle;
}

/**
 * Stores a discovered stream for a specific item index inside a scan,
 * preserving previously discovered master URLs, subtitles, qualities, and
 * extra linked posts or videos on merge.
 */
async function storeDiscoveredTopic(
  scanId: string,
  topicIndex: number,
  stream: ProbedStream,
  countChecked = false,
  options?: {
    readonly appendDistinctVideo?: boolean;
    readonly linkedPostMode?: boolean;
  },
): Promise<void> {
  await updateTrackScan(scanId, (scan) => {
    const item = scan.items?.[topicIndex];

    if (!item || scan.status !== "scanning") return null;

    const previous = scan.discovered.find(
      (discovered) => discovered.topicIndex === topicIndex,
    );

    const noteTitle = cleanLinkedTitle(stream.linkedTitle || "") || "Post";

    const incomingVideoTitle = stream.linkedTitle
      ? resolvedTopicTitle(item.fileTitle, stream.linkedTitle)
      : item.fileTitle;

    const secondaryAsExtraNote =
      options?.linkedPostMode && previous?.documents && stream.documents
        ? {
            title: noteTitle,
            ...(stream.sourceUrl ? { sourceUrl: stream.sourceUrl } : {}),
          }
        : undefined;

    const merged = mergeCapturedStream(previous || null, stream, {
      appendDistinctVideo: options?.appendDistinctVideo,
      secondaryAsExtraNote,
      primaryTitleForSplit: previous?.title || item.fileTitle,
      incomingVideoTitle,
    });

    const title = resolvedEntryTitle(
      item.fileTitle,
      previous?.title,
      stream.url ? stream.linkedTitle : undefined,
      Boolean(merged.extraVideos?.length),
    );

    const sourceUrl =
      (previous?.url ? previous.sourceUrl : stream.sourceUrl) ||
      previous?.sourceUrl ||
      item.url;

    const entry: DiscoveredTopicStream = Object.freeze({
      ...merged,
      title,
      sourceUrl,
      folderPath: item.folderPath,
      topicIndex,
    });

    return Object.freeze({
      ...scan,
      discovered: [
        ...scan.discovered.filter(
          (discovered) => discovered.topicIndex !== topicIndex,
        ),
        entry,
      ],
      nextTopicIndex: countChecked
        ? Math.min(scan.items.length, scan.nextTopicIndex + 1)
        : scan.nextTopicIndex,
    });
  });
}

function scheduleWorkerEarlyAdvance(tabId: number, delayMs: number): void {
  const existing = workerEarlyExitTimers.get(tabId);

  if (existing !== undefined) clearTimeout(existing);

  const timer = setTimeout(() => {
    workerEarlyExitTimers.delete(tabId);
    advanceWorkerProbe(tabId).catch(() => {});
  }, delayMs);

  workerEarlyExitTimers.set(tabId, timer);
}

function clearWorkerEarlyAdvance(tabId: number): void {
  const existing = workerEarlyExitTimers.get(tabId);

  if (existing !== undefined) {
    clearTimeout(existing);
    workerEarlyExitTimers.delete(tabId);
  }
}

async function resolveLinkedTitleForTab(
  tabId: number,
  presetTitle: string,
  followedLinkedVideo: boolean,
): Promise<string> {
  if (presetTitle || !followedLinkedVideo) return presetTitle;

  const heading = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, { type: "get-page-heading" })
      .catch(() => null),
  );

  if (typeof heading?.title === "string" && heading.title) return heading.title;
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  return tab?.title ? cleanLinkedTitle(tab.title) : "";
}

async function storeProbedStream(
  tabId: number,
  stream: ProbedStream,
): Promise<void> {
  const probe = await getTabProbe(tabId);

  if (!probe || probe.navigated === false) return;
  if (probe.previousStreamKey && stream.key === probe.previousStreamKey) return;
  const tabState = await getState(tabId).catch(() => null);

  const mergedSubtitles = uniqueSubtitles([
    ...(stream.subtitles || []),
    ...(probe.pendingSubtitles || []),
    ...(tabState?.subtitles || []),
  ]);

  const linkedTitle = await resolveLinkedTitleForTab(
    tabId,
    stream.linkedTitle || probe.linkedTitle || "",
    Boolean(probe.followedLinkedVideo),
  );

  await storeDiscoveredTopic(
    probe.scanId,
    probe.topicIndex,
    { ...stream, subtitles: mergedSubtitles, linkedTitle },
    false,
  );

  await chrome.storage.session.set({
    [probeKey(tabId)]: Object.freeze({
      ...probe,
      lastStreamKey: stream.key,
      streamCaptured: true,
      hasSubtitles: mergedSubtitles.length > 0,
      pendingSubtitles: [],
    }),
  });

  const isApiTrack = isApiTrackPage(probe.playlistUrl || stream.sourceUrl);

  scheduleWorkerEarlyAdvance(
    tabId,
    mergedSubtitles.length || isApiTrack ? 400 : 1400,
  );
}

async function storeProbeSubtitles(
  tabId: number,
  subtitles: readonly SubtitleTrack[],
): Promise<void> {
  const probe = await getTabProbe(tabId);

  if (!probe || probe.navigated === false || !subtitles.length) return;
  const result = { attached: false };

  await updateTrackScan(probe.scanId, (scan) => {
    const exists = scan.discovered.some(
      (item) => item.topicIndex === probe.topicIndex,
    );

    if (!exists) return null;
    result.attached = true;

    return Object.freeze({
      ...scan,
      discovered: scan.discovered.map((item) =>
        item.topicIndex === probe.topicIndex
          ? Object.freeze({
              ...item,
              subtitles: uniqueSubtitles([...item.subtitles, ...subtitles]),
            })
          : item,
      ),
    });
  });

  if (!result.attached) {
    const buffered = uniqueSubtitles([
      ...(probe.pendingSubtitles || []),
      ...subtitles,
    ]);

    await chrome.storage.session.set({
      [probeKey(tabId)]: Object.freeze({
        ...probe,
        pendingSubtitles: buffered,
      }),
    });

    return;
  }

  if (probe.streamCaptured && !probe.hasSubtitles) {
    await chrome.storage.session.set({
      [probeKey(tabId)]: Object.freeze({ ...probe, hasSubtitles: true }),
    });

    scheduleWorkerEarlyAdvance(tabId, 250);
  }
}

function hiddenFrameKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

/**
 * Resolves the active hidden-probe observer for a frame or its immediate
 * parent frame (capturing nested video-player iframes without touching the
 * top-level page's own player iframe whose parentFrameId is 0).
 */
function resolveHiddenFrameProbe(
  tabId: number,
  frameId = 0,
  parentFrameId = -1,
): HiddenFrameProbe | null {
  if (typeof frameId === "number" && frameId > 0) {
    const direct = hiddenFrameProbes.get(hiddenFrameKey(tabId, frameId));

    if (direct) return direct;
  }

  if (typeof parentFrameId === "number" && parentFrameId > 0) {
    return hiddenFrameProbes.get(hiddenFrameKey(tabId, parentFrameId)) || null;
  }

  return null;
}

async function resolveEmbedPlayerStream(
  rawEmbedUrl: string,
  sourceUrl: string,
  extraSubtitleUrls: readonly SubtitleCandidate[] = [],
  ruleId = mediaAuthorizationRuleId,
  fallbackText = "",
  sourceTabId: number | null = null,
): Promise<ProbedStream | null> {
  const embedUrl = normalizeEmbedPlayerUrl(rawEmbedUrl);

  if (!embedUrl) return null;

  const rule = embedPlayerAuthorizationRule(
    embedUrl,
    sourceUrl,
    chrome.runtime.id,
    ruleId,
  );

  if (rule) {
    await chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [toMutableSessionRule(rule, ruleId)],
      })
      .catch(() => {});
  }

  try {
    const response = await fetch(embedUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    }).catch(() => null);

    if (!response?.ok) return null;

    const parsed = parseEmbedPlayerConfig(await response.text(), embedUrl);

    if (!parsed) return null;

    const combinedSubtitles: SubtitleCandidate[] = [
      ...parsed.subtitles,
      ...extraSubtitleUrls,
    ];

    const effectiveTitle = parsed.title || fallbackText;

    if (parsed.hlsUrl) {
      const hlsStream = await buildProbedStream(
        parsed.hlsUrl,
        sourceUrl,
        combinedSubtitles,
        ruleId,
        effectiveTitle,
        sourceTabId,
      );

      if (hlsStream) {
        return parsed.title
          ? Object.freeze({ ...hlsStream, title: parsed.title })
          : hlsStream;
      }
    }

    if (!parsed.progressiveOptions.length) return null;

    const subtitles = await resolveExtraSubtitleList(
      combinedSubtitles,
      sourceUrl,
      effectiveTitle,
      sourceTabId,
    );

    const bestUrl = parsed.progressiveOptions[0].url;

    return Object.freeze({
      key: streamIdentity(bestUrl) || bestUrl,
      url: bestUrl,
      host: new URL(bestUrl).host,
      title: parsed.title || "Track stream",
      sourceUrl,
      kind: "direct" as const,
      qualityOptions: parsed.progressiveOptions,
      subtitles: uniqueSubtitles(subtitles),
      detectedAt: Date.now(),
    });
  } finally {
    if (rule) {
      await chrome.declarativeNetRequest
        .updateSessionRules({ removeRuleIds: [ruleId] })
        .catch(() => {});
    }
  }
}

async function storeActiveTabProbedStream(
  tabId: number,
  pageUrl: string,
  built: ProbedStream,
  documents?: TopicCompanionDocuments,
): Promise<void> {
  await enqueueDetection(async () => {
    const state = await synchronizePageState(tabId, pageUrl);
    const key = streamIdentity(built.url) || built.key || built.url;

    const existing = state.streams.find(
      (item) => (streamIdentity(item.url) || item.key || item.url) === key,
    );

    const merged: ProbedStream = Object.freeze({
      ...built,
      title:
        existing?.title && existing.title !== "Track stream"
          ? existing.title
          : built.title,
      qualityOptions: uniqueQualityOptions([
        ...built.qualityOptions,
        ...(existing?.qualityOptions || []),
      ]),
      subtitles: uniqueSubtitles([
        ...built.subtitles,
        ...(existing?.subtitles || []),
      ]),
    });

    const streams = [
      merged,
      ...state.streams.filter(
        (item) => (streamIdentity(item.url) || item.key || item.url) !== key,
      ),
    ];

    const subtitles = uniqueSubtitles([
      ...state.subtitles,
      ...merged.subtitles,
    ]);

    const mergedDocuments = mergeTopicCompanionDocuments(
      state.documents,
      documents,
    );

    await setState(tabId, {
      pageUrl: state.pageUrl || pageUrl,
      streams,
      subtitles,
      ...(mergedDocuments ? { documents: mergedDocuments } : {}),
    });
  });
}

async function resolveFrameProbeStream(
  frameProbe: HiddenFrameProbe,
  baseUrl: string | null,
  embedUrl: string | null,
  extraSubtitles: readonly SubtitleCandidate[],
  tabId: number,
): Promise<ProbedStream | null> {
  if (baseUrl) {
    return buildProbedStream(
      baseUrl,
      frameProbe.sourceUrl,
      extraSubtitles,
      frameProbe.ruleId,
      frameProbe.topicTitle,
      tabId,
    );
  }

  return embedUrl
    ? resolveEmbedPlayerStream(
        embedUrl,
        frameProbe.sourceUrl,
        extraSubtitles,
        frameProbe.ruleId,
        frameProbe.topicTitle,
        tabId,
      )
    : null;
}

async function recordTabTrackStream(
  tabId: number,
  stream: TrackStreamSignal,
  baseUrl: string | null,
  embedUrl: string | null,
  extraSubtitles: readonly SubtitleCandidate[],
  documents: TopicCompanionDocuments | undefined,
): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const pageUrl = tab?.url || safeMediaUrl(stream?.sourceUrl) || "";

  if (embedUrl && !baseUrl) {
    const built = await resolveEmbedPlayerStream(
      embedUrl,
      pageUrl,
      extraSubtitles,
      mediaAuthorizationRuleId,
      tab?.title || "",
      tabId,
    );

    if (built) {
      await storeActiveTabProbedStream(tabId, pageUrl, built, documents);
    }

    return;
  }

  const probe = await getTabProbe(tabId);

  if (!probe || !baseUrl) return;

  const built = await buildProbedStream(
    baseUrl,
    pageUrl,
    extraSubtitles,
    mediaAuthorizationRuleId,
    "",
    tabId,
  );

  if (built) {
    await storeProbedStream(tabId, documents ? { ...built, documents } : built);
  }
}

async function recordTrackStream(
  tabId: number,
  stream: TrackStreamSignal,
  frameId = 0,
): Promise<void> {
  const frameProbe = hiddenFrameProbes.get(hiddenFrameKey(tabId, frameId));
  const baseUrl = safeMediaUrl(stream?.mediaUrl) || safeMediaUrl(stream?.url);
  const embedUrl = normalizeEmbedPlayerUrl(stream?.embedUrl);

  if (!baseUrl && !embedUrl) return;

  const documents = validatedDocumentsRecord(stream?.documents);

  const extraSubtitles = Array.isArray(stream?.subtitles)
    ? stream.subtitles
    : [];

  if (frameProbe) {
    const built = await resolveFrameProbeStream(
      frameProbe,
      baseUrl,
      embedUrl,
      extraSubtitles,
      tabId,
    );

    if (built) {
      frameProbe.onStream(documents ? { ...built, documents } : built);
    }

    return;
  }

  await recordTabTrackStream(
    tabId,
    stream,
    baseUrl,
    embedUrl,
    extraSubtitles,
    documents,
  );
}

async function ensureMainWorldProbeInjected(tabId: number): Promise<boolean> {
  if (!chrome.scripting?.executeScript) return false;

  return chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["dist/page-track-probe.js"],
      world: "MAIN",
    })
    .then(() => true)
    .catch(() => false);
}

/**
 * Runs a headless parallel probe inside a signed-in playlist tab (or hidden
 * same-origin iframe) via page-track-probe.js (0 new tabs opened).
 */
async function probeTrackTopicsInTab(
  scanId: string,
  tabId: number,
  topicIndices: readonly number[],
  frameId = 0,
  allowInjectRetry = true,
): Promise<TrackProbeResult> {
  if (!topicIndices.length) {
    return {
      ok: true,
      rateLimited: false,
      unresolvedIndices: [],
      unresolvedLinks: {},
      unresolvedLinkLists: {},
    };
  }

  const scan = await getTrackScan(scanId);

  if (!scan || scan.status !== "scanning") {
    return {
      ok: false,
      rateLimited: false,
      unresolvedIndices: [],
      unresolvedLinks: {},
      unresolvedLinkLists: {},
    };
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);

  if (!tab?.url) {
    return {
      ok: false,
      rateLimited: false,
      unresolvedIndices: [...topicIndices],
      unresolvedLinks: {},
      unresolvedLinkLists: {},
    };
  }

  const tabUrl = tab.url;
  const requestId = crypto.randomUUID();

  const payload = topicIndices.map((topicIndex) => ({
    topicIndex,
    id: scan.items[topicIndex].id,
    title: scan.items[topicIndex].fileTitle,
    sectionTitle: scan.items[topicIndex].folderPath.at(-1) || "",
    url: scan.items[topicIndex].url,
  }));

  const attemptResult = await new Promise<TrackProbeAttemptResult>(
    (resolve) => {
      const inspectionQueue: ProbeJob[] = [];

      const probeState: {
        activeWorkers: number;
        probeDone: boolean;
        rateLimited: boolean;
        unresolvedIndices: number[];
        unresolvedLinks: Record<string, string>;
        unresolvedLinkLists: Record<string, readonly string[]>;
      } = {
        activeWorkers: 0,
        probeDone: false,
        rateLimited: false,
        unresolvedIndices: [],
        unresolvedLinks: {},
        unresolvedLinkLists: {},
      };

      const finishIfReady = (): void => {
        if (
          !probeState.probeDone ||
          probeState.activeWorkers > 0 ||
          inspectionQueue.length > 0
        ) {
          return;
        }

        const active = activeHeadlessProbes.get(requestId);

        if (!active) return;
        if (active.timeout !== null) clearTimeout(active.timeout);
        activeHeadlessProbes.delete(requestId);

        resolve(
          Object.freeze({
            ok: true,
            needsInject: false,
            rateLimited: probeState.rateLimited,
            unresolvedIndices: probeState.unresolvedIndices,
            unresolvedLinks: probeState.unresolvedLinks,
            unresolvedLinkLists: probeState.unresolvedLinkLists,
          }),
        );
      };

      const resolveProbeJobStream = async (
        job: ProbeJob,
        slotRuleId: number,
        titleHint: string,
      ): Promise<ProbedStream | null> => {
        if (job.rawUrl) {
          return buildProbedStream(
            job.rawUrl,
            job.sourceUrl || tabUrl,
            job.subtitles,
            slotRuleId,
            titleHint,
            tabId,
          );
        }

        if (!job.embedUrl) return null;

        return resolveEmbedPlayerStream(
          job.embedUrl,
          job.sourceUrl || tabUrl,
          job.subtitles,
          slotRuleId,
          titleHint,
          tabId,
        );
      };

      const inspectOneJob = async (
        job: ProbeJob,
        slotRuleId: number,
      ): Promise<void> => {
        const topicTitleText = scan.items[job.topicIndex]?.fileTitle || "";

        const built = await resolveProbeJobStream(
          job,
          slotRuleId,
          `${topicTitleText} ${scan.title || ""}`,
        );

        if (!built && !job.documents) {
          if (!job.partial) await incrementCheckedTopicCount(scanId);

          return;
        }

        const entryStream = built
          ? {
              ...built,
              ...(job.linkedTitle ? { linkedTitle: job.linkedTitle } : {}),
              ...(job.documents ? { documents: job.documents } : {}),
            }
          : documentsOnlyStream(
              job.topicIndex,
              job.sourceUrl || tabUrl,
              job.documents as TopicCompanionDocuments,
              job.linkedTitle,
            );

        await storeDiscoveredTopic(
          scanId,
          job.topicIndex,
          entryStream,
          !job.partial,
        );
      };

      const pumpInspections = (): void => {
        while (
          probeState.activeWorkers < INSPECT_CONCURRENCY &&
          inspectionQueue.length > 0
        ) {
          const job = inspectionQueue.shift();

          if (!job) break;
          probeState.activeWorkers += 1;

          const slotRuleId =
            mediaAuthorizationRuleId +
            1 +
            (workerRuntime.nextAuthorizationSlot++ % INSPECT_CONCURRENCY);

          inspectOneJob(job, slotRuleId)
            .catch(() =>
              job.partial ? null : incrementCheckedTopicCount(scanId),
            )
            .finally(() => {
              chrome.declarativeNetRequest
                .updateSessionRules({ removeRuleIds: [slotRuleId] })
                .catch(() => {});

              probeState.activeWorkers -= 1;
              pumpInspections();
              finishIfReady();
            });
        }
      };

      const resetTimeout = (): void => {
        const entry = activeHeadlessProbes.get(requestId);

        if (!entry) return;
        if (entry.timeout !== null) clearTimeout(entry.timeout);

        entry.timeout = setTimeout(() => {
          if (!activeHeadlessProbes.delete(requestId)) return;

          resolve(
            Object.freeze({
              ok: false,
              needsInject: false,
              rateLimited: false,
              unresolvedIndices: [...topicIndices],
              unresolvedLinks: {},
              unresolvedLinkLists: {},
            }),
          );
        }, 25000);
      };

      activeHeadlessProbes.set(requestId, {
        scanId,
        tabId,
        frameId,
        timeout: null,
        onTopic(topicIndex, stream, partial = false) {
          resetTimeout();

          const rawUrl =
            safeMediaUrl(stream?.mediaUrl) || safeMediaUrl(stream?.url) || "";

          const embedUrl = normalizeEmbedPlayerUrl(stream?.embedUrl) || "";
          const documents = validatedDocumentsRecord(stream?.documents);

          if (!rawUrl && !embedUrl && documents) {
            const linkedTitle =
              typeof stream?.linkedTitle === "string" ? stream.linkedTitle : "";

            probeState.activeWorkers += 1;

            storeDiscoveredTopic(
              scanId,
              topicIndex,
              documentsOnlyStream(
                topicIndex,
                safeMediaUrl(stream?.sourceUrl) || tabUrl,
                documents,
                linkedTitle,
              ),
              !partial,
            )
              .catch(() =>
                partial ? null : incrementCheckedTopicCount(scanId),
              )
              .finally(() => {
                probeState.activeWorkers -= 1;
                finishIfReady();
              });

            return;
          }

          if (!rawUrl && !embedUrl) {
            if (!partial) incrementCheckedTopicCount(scanId).catch(() => {});

            return;
          }

          inspectionQueue.push({
            topicIndex,
            rawUrl,
            ...(embedUrl ? { embedUrl } : {}),
            subtitles: Array.isArray(stream?.subtitles) ? stream.subtitles : [],
            linkedTitle:
              typeof stream?.linkedTitle === "string" ? stream.linkedTitle : "",
            sourceUrl: safeMediaUrl(stream?.sourceUrl) || "",
            ...(documents ? { documents } : {}),
            ...(partial ? { partial: true } : {}),
          });

          pumpInspections();
        },
        onDone(
          unresolvedIndices,
          unresolvedLinks = {},
          rateLimited = false,
          unresolvedLinkLists = {},
        ) {
          probeState.probeDone = true;
          probeState.rateLimited = Boolean(rateLimited);

          probeState.unresolvedIndices = unresolvedIndices.filter(
            (index): index is number =>
              typeof index === "number" &&
              Number.isInteger(index) &&
              index >= 0 &&
              index < scan.items.length,
          );

          probeState.unresolvedLinks = Object.fromEntries(
            Object.entries(unresolvedLinks || {})
              .map(([key, value]): readonly [string, string | null] => [
                key,
                safeMediaUrl(value),
              ])
              .filter((entry): entry is readonly [string, string] =>
                Boolean(entry[1]),
              ),
          );

          probeState.unresolvedLinkLists = Object.fromEntries(
            Object.entries(unresolvedLinkLists || {})
              .map(([key, value]): readonly [string, readonly string[]] => [
                key,
                Array.isArray(value)
                  ? value
                      .map((item) => safeMediaUrl(item))
                      .filter((item): item is string => Boolean(item))
                      .slice(0, 5)
                  : [],
              ])
              .filter(([, list]) => list.length > 0),
          );

          finishIfReady();
        },
      });

      resetTimeout();

      chrome.tabs
        .sendMessage(
          tabId,
          {
            type: "probe-track-topics",
            requestId,
            items: payload,
          },
          { frameId },
        )
        .catch(() => null)
        .then((rawAck: unknown) => {
          const ack = externalRecord(rawAck);

          if (ack?.ok) return;
          const entry = activeHeadlessProbes.get(requestId);

          if (entry && entry.timeout !== null) clearTimeout(entry.timeout);
          activeHeadlessProbes.delete(requestId);

          resolve(
            Object.freeze({
              ok: false,
              needsInject: ack?.reason === "probe-not-ready",
              rateLimited: false,
              unresolvedIndices: [...topicIndices],
              unresolvedLinks: {},
              unresolvedLinkLists: {},
            }),
          );
        });
    },
  );

  if (
    !attemptResult.ok &&
    attemptResult.needsInject &&
    allowInjectRetry &&
    frameId === 0
  ) {
    const injected = await ensureMainWorldProbeInjected(tabId);

    if (injected) {
      return probeTrackTopicsInTab(scanId, tabId, topicIndices, 0, false);
    }
  }

  return Object.freeze({
    ok: attemptResult.ok,
    rateLimited: Boolean(attemptResult.rateLimited),
    unresolvedIndices: attemptResult.unresolvedIndices,
    unresolvedLinks: attemptResult.unresolvedLinks,
    unresolvedLinkLists: attemptResult.unresolvedLinkLists,
  });
}

function markdownHasSupplementaryLinkedPost(
  markdown: string,
  pageUrl: string,
): boolean {
  if (!markdown || !pageUrl) return false;

  for (const match of markdown.matchAll(/https?:\/\/[^\s)>"]+/gi)) {
    if (isSupplementaryLinkedPostUrl(match[0], pageUrl)) return true;
  }

  return false;
}

async function seedCurrentTopicFromTab(
  scanId: string,
  scan: TrackScan,
  sourceTabId: number | null,
): Promise<Set<number>> {
  if (!validTabId(sourceTabId)) return new Set();
  const sourceState = await getState(sourceTabId).catch(() => null);
  const activeStream = sourceState?.streams?.[0] || null;

  if (!activeStream || !sourceState) return new Set();

  const currentIdx = scan.items.findIndex(
    (item) =>
      item.navigationIndex === -1 ||
      (sourceState.pageUrl && item.url === sourceState.pageUrl),
  );

  if (currentIdx < 0) return new Set();

  const pageTracks = externalRecord(
    await chrome.tabs
      .sendMessage(sourceTabId, { type: "collect-page-subtitles" })
      .catch(() => null),
  );

  const rawPageTracks = Array.isArray(pageTracks?.tracks)
    ? await Promise.all(
        (pageTracks.tracks as SubtitleCandidate[]).map((track) =>
          resolveExtraSubtitle(
            track,
            sourceState.pageUrl || "",
            scan.items[currentIdx]?.fileTitle || scan.title || "",
            sourceTabId,
          ),
        ),
      )
    : [];

  const mergedSubtitles = uniqueSubtitles([
    ...(activeStream.subtitles || []),
    ...(sourceState.subtitles || []),
    ...rawPageTracks.filter(isPresent),
  ]);

  const domDocuments = await extractFrameDocuments(sourceTabId);

  const documents = mergeTopicCompanionDocuments(
    mergeTopicCompanionDocuments(activeStream.documents, sourceState.documents),
    domDocuments,
  );

  const hasLinkedPosts = Boolean(
    documents?.markdown &&
    sourceState.pageUrl &&
    markdownHasSupplementaryLinkedPost(documents.markdown, sourceState.pageUrl),
  );

  const fullyResolved =
    !hasLinkedPosts &&
    (mergedSubtitles.length > 0 || isApiTrackPage(sourceState.pageUrl));

  await storeDiscoveredTopic(
    scanId,
    currentIdx,
    {
      ...activeStream,
      subtitles: mergedSubtitles,
      ...(documents ? { documents } : {}),
    },
    fullyResolved,
  );

  return fullyResolved ? new Set([currentIdx]) : new Set();
}

function originOfUrl(rawUrl: string): string {
  if (!rawUrl) return "";

  try {
    return new URL(rawUrl).origin;
  } catch {
    return "";
  }
}

function topicTargetUrl(
  scan: TrackScan,
  unresolvedLinks: Readonly<Record<string, string>>,
  topicIndex: number,
): string {
  return (
    safeMediaUrl(unresolvedLinks[String(topicIndex)]) ||
    scan.items[topicIndex]?.url ||
    ""
  );
}

/**
 * Splits pending item indices into same-origin (eligible for invisible
 * offscreen iframe scanning) and cross-origin buckets.
 */
function partitionSameOriginTopics(
  scan: TrackScan,
  indices: readonly number[],
  unresolvedLinks: Readonly<Record<string, string>>,
  sourceOrigin: string,
): { readonly sameOrigin: number[]; readonly crossOrigin: number[] } {
  const isSameOrigin = (topicIndex: number): boolean =>
    originOfUrl(topicTargetUrl(scan, unresolvedLinks, topicIndex)) ===
    sourceOrigin;

  return Object.freeze({
    sameOrigin: indices.filter(isSameOrigin),
    crossOrigin: indices.filter((index) => !isSameOrigin(index)),
  });
}

async function openHiddenProbeFrameInTab(
  sourceTabId: number,
  url: string,
  onReady?: (frameId: number) => void,
): Promise<HiddenFrameHandle | null> {
  const probeId = crypto.randomUUID();

  const readyPromise = new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingHiddenFrameReady.delete(probeId);
      resolve(null);
    }, 4500);

    pendingHiddenFrameReady.set(probeId, {
      tabId: sourceTabId,
      origin: originOfUrl(url),
      resolve(frameId) {
        clearTimeout(timer);
        pendingHiddenFrameReady.delete(probeId);

        if (
          typeof onReady === "function" &&
          frameId !== null &&
          Number.isSafeInteger(frameId) &&
          frameId > 0
        ) {
          onReady(frameId);
        }

        resolve(frameId);
      },
    });
  });

  const opened = externalRecord(
    await chrome.tabs
      .sendMessage(
        sourceTabId,
        { type: "open-hidden-probe-frame", probeId, url },
        { frameId: 0 },
      )
      .catch(() => null),
  );

  if (!opened?.ok) {
    pendingHiddenFrameReady.delete(probeId);

    return null;
  }

  const frameId = await readyPromise;

  if (frameId === null || !Number.isSafeInteger(frameId) || frameId <= 0) {
    await closeHiddenProbeFrameInTab(sourceTabId, probeId);

    return null;
  }

  return Object.freeze({ probeId, frameId });
}

async function closeHiddenProbeFrameInTab(
  sourceTabId: number,
  probeId: string,
): Promise<void> {
  await chrome.tabs
    .sendMessage(
      sourceTabId,
      { type: "close-hidden-probe-frame", probeId },
      { frameId: 0 },
    )
    .catch(() => {});
}

async function collectFrameDomSubtitles(
  sourceTabId: number,
  frameId: number,
  targetUrl: string,
  topicTitle: string,
): Promise<SubtitleTrack[]> {
  const domTracks = externalRecord(
    await chrome.tabs
      .sendMessage(sourceTabId, { type: "collect-page-subtitles" }, { frameId })
      .catch(() => null),
  );

  if (!Array.isArray(domTracks?.tracks) || !domTracks.tracks.length) return [];

  const resolved = await Promise.all(
    (domTracks.tracks as SubtitleCandidate[]).map((track) =>
      resolveExtraSubtitle(track, targetUrl, topicTitle, sourceTabId),
    ),
  );

  return resolved.filter(isPresent);
}

async function fetchFramePageHeading(
  sourceTabId: number,
  frameId: number,
  isLinkedVideo: boolean,
): Promise<string> {
  if (!isLinkedVideo) return "";

  return chrome.tabs
    .sendMessage(sourceTabId, { type: "get-page-heading" }, { frameId })
    .then((raw: unknown) => {
      const res = externalRecord(raw);

      return typeof res?.title === "string" ? res.title : "";
    })
    .catch(() => "");
}

async function findLinkedVideoInFrame(
  sourceTabId: number,
  frameId: number,
): Promise<string> {
  const linked = externalRecord(
    await chrome.tabs
      .sendMessage(
        sourceTabId,
        { type: "find-linked-video-in-page" },
        { frameId },
      )
      .catch(() => null),
  );

  return safeMediaUrl(linked?.url) || "";
}

async function collectDomDirectVideoInFrame(
  tabId: number,
  frameId: number,
): Promise<string> {
  const res = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, { type: "collect-direct-video" }, { frameId })
      .catch(() => null),
  );

  const url = safeMediaUrl(res?.url);

  return url && isDirectVideoUrl(url) ? url : "";
}

async function finalizeMissingStreamHiddenFrame(
  context: FinalizeHiddenFrameContext,
): Promise<HiddenFrameTopicOutcome> {
  const directVideoUrl = await collectDomDirectVideoInFrame(
    context.sourceTabId,
    context.frameId,
  );

  if (directVideoUrl) {
    const builtDirect = await buildProbedStream(
      directVideoUrl,
      context.targetUrl,
      context.subtitles,
      context.slotRuleId,
      context.item.fileTitle,
      context.sourceTabId,
    );

    if (
      builtDirect &&
      (!context.previousStreamKey ||
        builtDirect.key !== context.previousStreamKey)
    ) {
      return finalizeHiddenFrameTopic({
        ...context,
        capturedStream: builtDirect,
      });
    }
  }

  const domDocuments = await extractFrameDocuments(
    context.sourceTabId,
    context.frameId,
  );

  const linkedTitle = await fetchFramePageHeading(
    context.sourceTabId,
    context.frameId,
    context.isLinkedVideo,
  );

  if (domDocuments) {
    await storeDiscoveredTopic(
      context.scanId,
      context.topicIndex,
      documentsOnlyStream(
        context.topicIndex,
        context.targetUrl,
        domDocuments,
        linkedTitle,
      ),
      false,
      {
        appendDistinctVideo: Boolean(context.appendDistinctVideo),
        linkedPostMode: Boolean(context.linkedPostMode),
      },
    );
  }

  if (!context.isLinkedVideo) {
    const linkedUrl = await findLinkedVideoInFrame(
      context.sourceTabId,
      context.frameId,
    );

    if (linkedUrl) {
      return Object.freeze({
        captured: false,
        streamKey: context.previousStreamKey,
        linkedUrl,
      });
    }
  }

  if (!context.deferCountChecked) {
    await incrementCheckedTopicCount(context.scanId);
  }

  return Object.freeze({
    captured: Boolean(domDocuments),
    streamKey: context.previousStreamKey,
  });
}

/**
 * Persists a hidden-frame observation result (or increments checked count on
 * non-video items) and releases its per-worker DNR authorization rule.
 */
async function finalizeHiddenFrameTopic(
  context: FinalizeHiddenFrameContext,
): Promise<HiddenFrameTopicOutcome> {
  chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [context.slotRuleId] })
    .catch(() => {});

  if (!context.capturedStream) {
    return finalizeMissingStreamHiddenFrame(context);
  }

  const fallbackDomTracks = context.subtitles.length
    ? []
    : await collectFrameDomSubtitles(
        context.sourceTabId,
        context.frameId,
        context.targetUrl,
        context.item.fileTitle,
      );

  const linkedTitle = await fetchFramePageHeading(
    context.sourceTabId,
    context.frameId,
    context.isLinkedVideo,
  );

  const documents =
    context.capturedStream.documents ||
    (await extractFrameDocuments(context.sourceTabId, context.frameId));

  const mergedSubtitles = uniqueSubtitles([
    ...(context.capturedStream.subtitles || []),
    ...context.subtitles,
    ...fallbackDomTracks,
  ]);

  await storeDiscoveredTopic(
    context.scanId,
    context.topicIndex,
    {
      ...context.capturedStream,
      subtitles: mergedSubtitles,
      ...(linkedTitle ? { linkedTitle } : {}),
      ...(documents ? { documents } : {}),
    },
    !context.deferCountChecked,
    {
      appendDistinctVideo: Boolean(context.appendDistinctVideo),
      linkedPostMode: Boolean(context.linkedPostMode),
    },
  );

  return Object.freeze({
    captured: true,
    streamKey: context.capturedStream.key,
  });
}

interface HiddenFrameObserver {
  readonly promise: Promise<HiddenFrameTopicOutcome>;
  readonly abort: () => void;
}

interface HiddenFrameObserverState {
  capturedStream: ProbedStream | null;
  readonly subtitles: SubtitleTrack[];
  done: boolean;
  timer: TimerHandle | null;
}

function buildHiddenFrameObserverEntry(
  options: HiddenFrameObservationOptions,
  state: HiddenFrameObserverState,
  slotRuleId: number,
  schedule: (delayMs: number) => void,
): HiddenFrameProbe {
  const isApi = isApiTrackPage(options.targetUrl);

  return {
    scanId: options.scanId,
    topicIndex: options.topicIndex,
    sourceUrl: options.targetUrl,
    topicTitle: options.item.fileTitle,
    ruleId: slotRuleId,
    onStream(stream) {
      if (state.done) return;

      if (
        options.previousStreamKey &&
        stream.key === options.previousStreamKey
      ) {
        return;
      }

      state.capturedStream = mergeCapturedStream(state.capturedStream, stream);

      const hasSubs =
        (state.capturedStream.subtitles?.length || 0) > 0 ||
        state.subtitles.length > 0;

      schedule(hasSubs || isApi ? 400 : 1200);
    },
    onSubtitles(tracks) {
      if (state.done || !tracks.length) return;
      state.subtitles.push(...tracks);
      if (state.capturedStream) schedule(250);
    },
  };
}

/**
 * Registers a hidden-frame media observer synchronously and returns both its
 * completion promise and an abort handle for failed sidebar navigations.
 */
function createHiddenFrameObserver(
  options: HiddenFrameObservationOptions,
): HiddenFrameObserver {
  const key = hiddenFrameKey(options.sourceTabId, options.frameId);

  const slotRuleId =
    mediaAuthorizationRuleId +
    1 +
    (workerRuntime.nextAuthorizationSlot++ % INSPECT_CONCURRENCY);

  const state: HiddenFrameObserverState = {
    capturedStream: null,
    subtitles: [],
    done: false,
    timer: null,
  };

  const stopObserver = (): boolean => {
    if (state.done) return false;
    state.done = true;
    if (state.timer !== null) clearTimeout(state.timer);
    hiddenFrameProbes.delete(key);

    return true;
  };

  const holder: { abort: () => void } = { abort: () => {} };

  const promise = new Promise<HiddenFrameTopicOutcome>((resolve) => {
    holder.abort = () => {
      if (!stopObserver()) return;

      chrome.declarativeNetRequest
        .updateSessionRules({ removeRuleIds: [slotRuleId] })
        .catch(() => {});

      resolve(
        Object.freeze({
          captured: false,
          streamKey: options.previousStreamKey,
        }),
      );
    };

    const finish = async (): Promise<void> => {
      if (!stopObserver()) return;

      const outcome = await finalizeHiddenFrameTopic({
        ...options,
        slotRuleId,
        capturedStream: state.capturedStream,
        subtitles: state.subtitles,
      });

      resolve(outcome);
    };

    const schedule = (delayMs: number): void => {
      if (state.timer !== null) clearTimeout(state.timer);

      state.timer = setTimeout(() => {
        finish().catch(() => {});
      }, delayMs);
    };

    hiddenFrameProbes.set(
      key,
      buildHiddenFrameObserverEntry(options, state, slotRuleId, schedule),
    );

    schedule(options.initialTimeoutMs || 7500);
  });

  return Object.freeze({ promise, abort: () => holder.abort() });
}

/**
 * Opens an invisible same-origin iframe, arms the observer synchronously at
 * document_start before any item scripts run, and waits for capture.
 */
async function openAndObserveHiddenIframe(
  options: OpenHiddenIframeOptions,
): Promise<{
  readonly frame: HiddenFrameHandle;
  readonly outcome: HiddenFrameTopicOutcome;
} | null> {
  const holder: { observer: HiddenFrameObserver | null } = {
    observer: null,
  };

  const frame = await openHiddenProbeFrameInTab(
    options.sourceTabId,
    options.targetUrl,
    (frameId) => {
      holder.observer = createHiddenFrameObserver({
        scanId: options.scanId,
        sourceTabId: options.sourceTabId,
        frameId,
        topicIndex: options.topicIndex,
        item: options.item,
        targetUrl: options.targetUrl,
        isLinkedVideo: options.isLinkedVideo,
        previousStreamKey: options.previousStreamKey || "",
        initialTimeoutMs: options.navigateSidebar ? 12000 : 7500,
        deferCountChecked: options.deferCountChecked,
        appendDistinctVideo: options.appendDistinctVideo,
        linkedPostMode: options.linkedPostMode,
      });
    },
  );

  if (!frame || !holder.observer) return null;
  const navIndex = options.item.navigationIndex;

  if (
    options.navigateSidebar &&
    !options.isLinkedVideo &&
    typeof navIndex === "number" &&
    Number.isSafeInteger(navIndex) &&
    navIndex >= 0
  ) {
    const navResult = externalRecord(
      await chrome.tabs
        .sendMessage(
          options.sourceTabId,
          {
            type: "navigate-track-sidebar",
            topicIndex: navIndex,
            topicTitle: options.item.fileTitle,
            topicSection: options.item.folderPath.at(-1) || "",
          },
          { frameId: frame.frameId },
        )
        .catch(() => null),
    );

    if (navResult?.ok !== true) {
      holder.observer.abort();

      if (!options.deferCountChecked) {
        await incrementCheckedTopicCount(options.scanId);
      }
    }
  }

  const outcome = await holder.observer.promise;

  return Object.freeze({ frame, outcome });
}

function normalizedRoutePathKey(rawUrl: string): string {
  const safeUrl = safeMediaUrl(rawUrl);

  if (!safeUrl) return "";

  try {
    const parsed = new URL(safeUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, "") || "/";

    return `${parsed.origin}${cleanPath}${parsed.search}`;
  } catch {
    return "";
  }
}

function collectUniqueNonParentUrls(
  rawUrls: readonly unknown[],
  parentTopicUrl: string,
  requiredOrigin = "",
): string[] {
  const parentKey = normalizedRoutePathKey(parentTopicUrl);
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const rawUrl of rawUrls) {
    const safeUrl = safeMediaUrl(rawUrl);

    if (!safeUrl) continue;
    if (requiredOrigin && originOfUrl(safeUrl) !== requiredOrigin) continue;
    const key = normalizedRoutePathKey(safeUrl);

    if (!key || (parentKey && key === parentKey) || seen.has(key)) continue;
    seen.add(key);
    resolved.push(safeUrl);
    if (resolved.length >= 5) break;
  }

  return resolved;
}

function resolveTopicLinkedUrls(
  unresolvedLinks: Readonly<Record<string, string>>,
  unresolvedLinkLists: Readonly<Record<string, readonly string[]>>,
  topicIndex: number,
  parentTopicUrl = "",
): readonly string[] {
  const fromList = unresolvedLinkLists[String(topicIndex)];

  const rawList: readonly unknown[] =
    Array.isArray(fromList) && fromList.length > 0
      ? fromList
      : [unresolvedLinks[String(topicIndex)]];

  return collectUniqueNonParentUrls(rawList, parentTopicUrl);
}

async function probeLinkedUrlInTempIframe(options: {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly sourceOrigin: string;
  readonly topicIndex: number;
  readonly item: TrackTopic;
  readonly linkedUrl: string;
  readonly previousStreamKey: string;
  readonly deferCountChecked?: boolean;
  readonly appendDistinctVideo?: boolean;
  readonly linkedPostMode?: boolean;
}): Promise<HiddenFrameTopicOutcome> {
  if (originOfUrl(options.linkedUrl) !== options.sourceOrigin) {
    return Object.freeze({
      captured: false,
      streamKey: options.previousStreamKey,
      linkedUrl: options.linkedUrl,
    });
  }

  const run = await openAndObserveHiddenIframe({
    scanId: options.scanId,
    sourceTabId: options.sourceTabId,
    topicIndex: options.topicIndex,
    item: options.item,
    targetUrl: options.linkedUrl,
    isLinkedVideo: true,
    previousStreamKey: "",
    deferCountChecked: options.deferCountChecked,
    appendDistinctVideo: options.appendDistinctVideo,
    linkedPostMode: options.linkedPostMode,
  });

  if (run) {
    await closeHiddenProbeFrameInTab(options.sourceTabId, run.frame.probeId);

    return run.outcome;
  }

  return Object.freeze({
    captured: false,
    streamKey: options.previousStreamKey,
    linkedUrl: options.linkedUrl,
  });
}

async function probeLinkedUrlsInHiddenFrames(options: {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly sourceOrigin: string;
  readonly topicIndex: number;
  readonly item: TrackTopic;
  readonly linkedUrls: readonly string[];
  readonly previousStreamKey: string;
  readonly deferFinalCount?: boolean;
}): Promise<{
  readonly crossOriginUrl: string;
  readonly lastStreamKey: string;
}> {
  const sameOriginUrls = collectUniqueNonParentUrls(
    options.linkedUrls,
    options.item.url,
    options.sourceOrigin,
  );

  const crossOriginUrl =
    options.linkedUrls.find(
      (url) => originOfUrl(url) !== options.sourceOrigin,
    ) || "";

  if (!sameOriginUrls.length && !crossOriginUrl && !options.deferFinalCount) {
    await incrementCheckedTopicCount(options.scanId);
  }

  const cursor = { lastStreamKey: options.previousStreamKey };

  for (const [position, url] of sameOriginUrls.entries()) {
    if (position > 0) await pauseMs(550);

    const isLast = position === sameOriginUrls.length - 1;

    const outcome = await probeLinkedUrlInTempIframe({
      scanId: options.scanId,
      sourceTabId: options.sourceTabId,
      sourceOrigin: options.sourceOrigin,
      topicIndex: options.topicIndex,
      item: options.item,
      linkedUrl: url,
      previousStreamKey: "",
      deferCountChecked:
        Boolean(crossOriginUrl) || !isLast || Boolean(options.deferFinalCount),
      appendDistinctVideo: true,
      linkedPostMode: true,
    });

    cursor.lastStreamKey = outcome.streamKey || cursor.lastStreamKey;
  }

  return Object.freeze({
    crossOriginUrl,
    lastStreamKey: cursor.lastStreamKey,
  });
}

/**
 * Steps through one sidebar-button item inside an already-open invisible
 * iframe, arming the observer before triggering navigation so no early stream
 * event is missed. Linked videos always open in a temporary sibling iframe so
 * the primary iframe keeps the playlist sidebar intact.
 */
async function stepSidebarTopicInHiddenFrame(
  step: StepSidebarTopicInput,
): Promise<HiddenFrameTopicOutcome> {
  if (step.linkedUrls.length > 0) {
    const multi = await probeLinkedUrlsInHiddenFrames({
      scanId: step.scanId,
      sourceTabId: step.sourceTabId,
      sourceOrigin: step.sourceOrigin,
      topicIndex: step.topicIndex,
      item: step.item,
      linkedUrls: step.linkedUrls,
      previousStreamKey: step.previousStreamKey,
    });

    return Object.freeze({
      captured: !multi.crossOriginUrl,
      streamKey: multi.lastStreamKey,
      ...(multi.crossOriginUrl ? { linkedUrl: multi.crossOriginUrl } : {}),
    });
  }

  const observer = createHiddenFrameObserver({
    scanId: step.scanId,
    sourceTabId: step.sourceTabId,
    frameId: step.primaryFrame.frameId,
    topicIndex: step.topicIndex,
    item: step.item,
    targetUrl: step.item.url,
    isLinkedVideo: false,
    previousStreamKey: step.previousStreamKey,
  });

  const navResult = externalRecord(
    await chrome.tabs
      .sendMessage(
        step.sourceTabId,
        {
          type: "navigate-track-sidebar",
          topicIndex: step.item.navigationIndex,
          topicTitle: step.item.fileTitle,
          topicSection: step.item.folderPath.at(-1) || "",
        },
        { frameId: step.primaryFrame.frameId },
      )
      .catch(() => null),
  );

  if (navResult?.ok !== true) {
    observer.abort();
    await incrementCheckedTopicCount(step.scanId);

    return observer.promise;
  }

  const outcome = await observer.promise;

  if (!outcome.captured && outcome.linkedUrl) {
    return probeLinkedUrlInTempIframe({
      scanId: step.scanId,
      sourceTabId: step.sourceTabId,
      sourceOrigin: step.sourceOrigin,
      topicIndex: step.topicIndex,
      item: step.item,
      linkedUrl: outcome.linkedUrl,
      previousStreamKey: step.previousStreamKey,
      appendDistinctVideo: true,
      linkedPostMode: true,
    });
  }

  return outcome;
}

async function stepSidebarTopicsInHiddenFrame(
  context: StepSidebarTopicsContext,
): Promise<{
  readonly crossOrigin: number[];
  readonly discoveredLinks: Record<string, string>;
}> {
  const cursor = { previousKey: context.initialStreamKey };
  const crossOrigin: number[] = [];
  const discoveredLinks: Record<string, string> = {};

  for (const [stepIndex, topicIndex] of context.topicIndices.entries()) {
    if (stepIndex > 0) await pauseMs(550);

    const item = context.scan.items[topicIndex];

    const linkedUrls = resolveTopicLinkedUrls(
      context.unresolvedLinks,
      context.unresolvedLinkLists,
      topicIndex,
      item.url,
    );

    const outcome = await stepSidebarTopicInHiddenFrame({
      scanId: context.scanId,
      sourceTabId: context.sourceTabId,
      sourceOrigin: context.sourceOrigin,
      primaryFrame: context.primaryFrame,
      topicIndex,
      item,
      linkedUrls,
      previousStreamKey: cursor.previousKey,
    });

    if (!outcome.captured && outcome.linkedUrl) {
      crossOrigin.push(topicIndex);
      discoveredLinks[String(topicIndex)] = outcome.linkedUrl;
    }

    cursor.previousKey = outcome.streamKey;
  }

  return Object.freeze({ crossOrigin, discoveredLinks });
}

async function runParallelHiddenIframeQueue(
  context: ParallelHiddenIframeContext,
): Promise<void> {
  const queue = [...context.topicIndices];
  const isTrack = isTrackPage(context.scan.items[0]?.url || "");
  const concurrency = isTrack ? 1 : HIDDEN_IFRAME_CONCURRENCY;
  const workerCount = Math.min(concurrency, Math.max(queue.length, 1));
  const firstTopicOrigin = originOfUrl(context.scan.items[0]?.url || "");

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const topicIndex = queue.shift();

        if (topicIndex === undefined) break;
        const item = context.scan.items[topicIndex];

        const linkedUrls = resolveTopicLinkedUrls(
          context.unresolvedLinks,
          context.unresolvedLinkLists,
          topicIndex,
          item.url,
        );

        if (linkedUrls.length > 0) {
          await probeLinkedUrlsInHiddenFrames({
            scanId: context.scanId,
            sourceTabId: context.sourceTabId,
            sourceOrigin: firstTopicOrigin || originOfUrl(item.url),
            topicIndex,
            item,
            linkedUrls,
            previousStreamKey: "",
          });

          if (isTrack && queue.length > 0) await pauseMs(600);
          continue;
        }

        const result = await openAndObserveHiddenIframe({
          scanId: context.scanId,
          sourceTabId: context.sourceTabId,
          topicIndex,
          item,
          targetUrl: item.url,
          isLinkedVideo: false,
        });

        if (result) {
          await closeHiddenProbeFrameInTab(
            context.sourceTabId,
            result.frame.probeId,
          );
        }

        if (isTrack && queue.length > 0) await pauseMs(600);
      }
    }),
  );
}

async function resolveFirstHiddenFrameLinkedVideo(options: {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly sourceOrigin: string;
  readonly topicIndex: number;
  readonly item: TrackTopic;
  readonly outcome: HiddenFrameTopicOutcome;
  readonly remainingLinkedUrls: readonly string[];
  readonly previousStreamKey: string;
}): Promise<{
  readonly crossOrigin: number[];
  readonly links: Record<string, string>;
}> {
  if (options.remainingLinkedUrls.length > 0) {
    const multi = await probeLinkedUrlsInHiddenFrames({
      scanId: options.scanId,
      sourceTabId: options.sourceTabId,
      sourceOrigin: options.sourceOrigin,
      topicIndex: options.topicIndex,
      item: options.item,
      linkedUrls: options.remainingLinkedUrls,
      previousStreamKey: options.previousStreamKey,
    });

    if (multi.crossOriginUrl) {
      return Object.freeze({
        crossOrigin: [options.topicIndex],
        links: { [String(options.topicIndex)]: multi.crossOriginUrl },
      });
    }

    return Object.freeze({ crossOrigin: [], links: {} });
  }

  if (options.outcome.captured || !options.outcome.linkedUrl) {
    return Object.freeze({ crossOrigin: [], links: {} });
  }

  const linkedOutcome = await probeLinkedUrlInTempIframe({
    scanId: options.scanId,
    sourceTabId: options.sourceTabId,
    sourceOrigin: options.sourceOrigin,
    topicIndex: options.topicIndex,
    item: options.item,
    linkedUrl: options.outcome.linkedUrl,
    previousStreamKey: options.previousStreamKey,
    appendDistinctVideo: true,
    linkedPostMode: true,
  });

  if (!linkedOutcome.captured && linkedOutcome.linkedUrl) {
    return Object.freeze({
      crossOrigin: [options.topicIndex],
      links: { [String(options.topicIndex)]: linkedOutcome.linkedUrl },
    });
  }

  return Object.freeze({ crossOrigin: [], links: {} });
}

async function escalateHiddenTrackProbe(
  scanId: string,
  sourceTabId: number,
  frameId: number,
  afterFirst: readonly number[],
  firstWasLinkedPost: boolean,
): Promise<TrackProbeResult> {
  if (!afterFirst.length || firstWasLinkedPost) {
    return Object.freeze({
      ok: !firstWasLinkedPost,
      rateLimited: false,
      unresolvedIndices: firstWasLinkedPost ? [...afterFirst] : [],
      unresolvedLinks: {},
      unresolvedLinkLists: {},
    });
  }

  return probeTrackTopicsInTab(scanId, sourceTabId, afterFirst, frameId, false);
}

async function releaseReusableFirstFrame(
  sourceTabId: number,
  probeId: string,
  firstWasLinkedPost: boolean,
): Promise<void> {
  if (!firstWasLinkedPost) {
    await closeHiddenProbeFrameInTab(sourceTabId, probeId);
  }
}

function mergeEscalatedProbeLinks(
  unresolvedLinks: Readonly<Record<string, string>>,
  unresolvedLinkLists: Readonly<Record<string, readonly string[]>>,
  firstLinkedLinks: Readonly<Record<string, string>>,
  escalated: TrackProbeResult,
): {
  readonly mergedLinks: Record<string, string>;
  readonly mergedLinkLists: Record<string, readonly string[]>;
} {
  return {
    mergedLinks: escalated.ok
      ? {
          ...unresolvedLinks,
          ...firstLinkedLinks,
          ...escalated.unresolvedLinks,
        }
      : { ...unresolvedLinks, ...firstLinkedLinks },
    mergedLinkLists: escalated.ok
      ? { ...unresolvedLinkLists, ...escalated.unresolvedLinkLists }
      : { ...unresolvedLinkLists },
  };
}

async function stepSidebarAndLinkedTopics(options: {
  readonly scanId: string;
  readonly sourceTabId: number;
  readonly sourceOrigin: string;
  readonly trackPageUrl: string;
  readonly scan: TrackScan;
  readonly topicIndices: readonly number[];
  readonly unresolvedLinks: Readonly<Record<string, string>>;
  readonly unresolvedLinkLists: Readonly<Record<string, readonly string[]>>;
  readonly reusableTrackFrame: HiddenFrameHandle | null;
  readonly initialStreamKey: string;
  readonly seededTrackKey: string;
}): Promise<{
  readonly crossOrigin: number[];
  readonly discoveredLinks: Record<string, string>;
}> {
  const crossOrigin: number[] = [];
  const discoveredLinks: Record<string, string> = {};
  const sidebarIndices: number[] = [];
  const linkedCursor = { count: 0 };

  for (const topicIndex of options.topicIndices) {
    const item = options.scan.items[topicIndex];

    const linkedUrls = resolveTopicLinkedUrls(
      options.unresolvedLinks,
      options.unresolvedLinkLists,
      topicIndex,
      item.url,
    );

    if (!linkedUrls.length) {
      sidebarIndices.push(topicIndex);
      continue;
    }

    if (linkedCursor.count > 0) await pauseMs(550);
    linkedCursor.count += 1;

    const multi = await probeLinkedUrlsInHiddenFrames({
      scanId: options.scanId,
      sourceTabId: options.sourceTabId,
      sourceOrigin: options.sourceOrigin,
      topicIndex,
      item,
      linkedUrls,
      previousStreamKey: "",
    });

    if (multi.crossOriginUrl) {
      crossOrigin.push(topicIndex);
      discoveredLinks[String(topicIndex)] = multi.crossOriginUrl;
    }
  }

  if (!sidebarIndices.length) {
    if (options.reusableTrackFrame) {
      await closeHiddenProbeFrameInTab(
        options.sourceTabId,
        options.reusableTrackFrame.probeId,
      );
    }

    return Object.freeze({ crossOrigin, discoveredLinks });
  }

  const trackFrame =
    options.reusableTrackFrame ||
    (await openHiddenProbeFrameInTab(
      options.sourceTabId,
      options.trackPageUrl,
    ));

  if (!trackFrame) {
    return Object.freeze({
      crossOrigin: [...crossOrigin, ...sidebarIndices],
      discoveredLinks,
    });
  }

  const stepped = await stepSidebarTopicsInHiddenFrame({
    scanId: options.scanId,
    sourceTabId: options.sourceTabId,
    sourceOrigin: options.sourceOrigin,
    scan: options.scan,
    primaryFrame: trackFrame,
    topicIndices: sidebarIndices,
    unresolvedLinks: options.unresolvedLinks,
    unresolvedLinkLists: options.unresolvedLinkLists,
    initialStreamKey: options.reusableTrackFrame
      ? options.initialStreamKey
      : options.seededTrackKey,
  });

  await closeHiddenProbeFrameInTab(options.sourceTabId, trackFrame.probeId);

  return Object.freeze({
    crossOrigin: [...crossOrigin, ...stepped.crossOrigin],
    discoveredLinks: { ...discoveredLinks, ...stepped.discoveredLinks },
  });
}

/**
 * Tier 1.5 — Runs completely invisible desktop-sized offscreen same-origin
 * iframes inside the signed-in playlist tab (0 new Chrome tabs, 0 windows, 0
 * blinks). Captures the live API template on the first item to escalate
 * remaining items to parallel fetch, or steps invisibly across hidden iframes.
 */
async function runHiddenIframeScan(
  scanId: string,
  sourceTabId: number,
  scan: TrackScan,
  remaining: number[],
  unresolvedLinks: Record<string, string>,
  unresolvedLinkLists: Record<string, readonly string[]> = {},
): Promise<HiddenIframeScanResult> {
  const sourceTab = await chrome.tabs.get(sourceTabId).catch(() => null);
  const sourceOrigin = originOfUrl(sourceTab?.url || "");

  if (!sourceOrigin || !remaining.length) {
    return Object.freeze({ remaining, unresolvedLinks });
  }

  const initialPartition = partitionSameOriginTopics(
    scan,
    remaining,
    unresolvedLinks,
    sourceOrigin,
  );

  if (!initialPartition.sameOrigin.length) {
    return Object.freeze({ remaining, unresolvedLinks });
  }

  const firstIndex = initialPartition.sameOrigin[0];

  const firstLinks = resolveTopicLinkedUrls(
    unresolvedLinks,
    unresolvedLinkLists,
    firstIndex,
    scan.items[firstIndex]?.url || "",
  );

  const firstLinkedUrl = firstLinks[0] || "";
  const remainingFirstLinks = firstLinks.slice(1);
  const latestScan = (await getTrackScan(scanId)) || scan;

  const isSidebarButtons = scan.items.some((item) =>
    Number.isSafeInteger(item.navigationIndex),
  );

  const seededTrackKey = isSidebarButtons
    ? latestScan.discovered[0]?.key || ""
    : "";

  const initialSeededKey = !firstLinkedUrl ? seededTrackKey : "";

  const firstRun = await openAndObserveHiddenIframe({
    scanId,
    sourceTabId,
    topicIndex: firstIndex,
    item: scan.items[firstIndex],
    targetUrl: firstLinkedUrl || scan.items[firstIndex].url,
    isLinkedVideo: Boolean(firstLinkedUrl),
    navigateSidebar: !firstLinkedUrl,
    previousStreamKey: initialSeededKey,
    deferCountChecked: remainingFirstLinks.length > 0,
    appendDistinctVideo: Boolean(firstLinkedUrl),
    linkedPostMode: Boolean(firstLinkedUrl),
  });

  if (!firstRun) return Object.freeze({ remaining, unresolvedLinks });

  const firstLinked = await resolveFirstHiddenFrameLinkedVideo({
    scanId,
    sourceTabId,
    sourceOrigin,
    topicIndex: firstIndex,
    item: scan.items[firstIndex],
    outcome: firstRun.outcome,
    remainingLinkedUrls: remainingFirstLinks,
    previousStreamKey: initialSeededKey,
  });

  const firstWasLinked = Boolean(firstLinkedUrl);

  if (firstWasLinked) {
    await closeHiddenProbeFrameInTab(sourceTabId, firstRun.frame.probeId);
  }

  const afterFirst = initialPartition.sameOrigin.slice(1);

  const escalated = await escalateHiddenTrackProbe(
    scanId,
    sourceTabId,
    firstRun.frame.frameId,
    afterFirst,
    firstWasLinked,
  );

  const { mergedLinks, mergedLinkLists } = mergeEscalatedProbeLinks(
    unresolvedLinks,
    unresolvedLinkLists,
    firstLinked.links,
    escalated,
  );

  if (escalated.rateLimited) {
    await releaseReusableFirstFrame(
      sourceTabId,
      firstRun.frame.probeId,
      firstWasLinked,
    );

    return Object.freeze({
      remaining: [],
      unresolvedLinks: mergedLinks,
      rateLimited: true,
    });
  }

  const stillRemaining = escalated.ok
    ? escalated.unresolvedIndices
    : afterFirst;

  const nextPartition = partitionSameOriginTopics(
    scan,
    stillRemaining,
    mergedLinks,
    sourceOrigin,
  );

  if (!nextPartition.sameOrigin.length) {
    await releaseReusableFirstFrame(
      sourceTabId,
      firstRun.frame.probeId,
      firstWasLinked,
    );

    return Object.freeze({
      remaining: [
        ...initialPartition.crossOrigin,
        ...firstLinked.crossOrigin,
        ...nextPartition.crossOrigin,
      ],
      unresolvedLinks: mergedLinks,
    });
  }

  if (isSidebarButtons) {
    const stepped = await stepSidebarAndLinkedTopics({
      scanId,
      sourceTabId,
      sourceOrigin,
      trackPageUrl: sourceTab?.url || scan.items[0].url,
      scan,
      topicIndices: nextPartition.sameOrigin,
      unresolvedLinks: mergedLinks,
      unresolvedLinkLists: mergedLinkLists,
      reusableTrackFrame: firstWasLinked ? null : firstRun.frame,
      initialStreamKey: firstRun.outcome.streamKey,
      seededTrackKey,
    });

    return Object.freeze({
      remaining: [
        ...initialPartition.crossOrigin,
        ...firstLinked.crossOrigin,
        ...nextPartition.crossOrigin,
        ...stepped.crossOrigin,
      ],
      unresolvedLinks: { ...mergedLinks, ...stepped.discoveredLinks },
    });
  }

  await releaseReusableFirstFrame(
    sourceTabId,
    firstRun.frame.probeId,
    firstWasLinked,
  );

  await runParallelHiddenIframeQueue({
    scanId,
    sourceTabId,
    scan,
    topicIndices: nextPartition.sameOrigin,
    unresolvedLinks: mergedLinks,
    unresolvedLinkLists: mergedLinkLists,
  });

  return Object.freeze({
    remaining: [
      ...initialPartition.crossOrigin,
      ...firstLinked.crossOrigin,
      ...nextPartition.crossOrigin,
    ],
    unresolvedLinks: mergedLinks,
  });
}

async function runHeadlessTrackScan(
  scanId: string,
  sourceTabId: number | null,
): Promise<void> {
  const scan = await getTrackScan(scanId);

  if (!scan || scan.status !== "scanning") return;
  const resolved = await seedCurrentTopicFromTab(scanId, scan, sourceTabId);

  const initialRemaining = scan.items
    .map((_, index) => index)
    .filter((index) => !resolved.has(index));

  const tier1Result =
    validTabId(sourceTabId) && initialRemaining.length > 0
      ? await probeTrackTopicsInTab(scanId, sourceTabId, initialRemaining)
      : {
          ok: false,
          rateLimited: false,
          unresolvedIndices: initialRemaining,
          unresolvedLinks: {},
          unresolvedLinkLists: {},
        };

  if (tier1Result.rateLimited) {
    await markTrackScanReady(scanId, true);

    return;
  }

  const afterTier1 = tier1Result.ok
    ? tier1Result.unresolvedIndices
    : initialRemaining;

  const linksAfterTier1 = tier1Result.ok ? tier1Result.unresolvedLinks : {};

  const linkListsAfterTier1 = tier1Result.ok
    ? tier1Result.unresolvedLinkLists
    : {};

  if (!afterTier1.length) {
    await markTrackScanReady(scanId);

    return;
  }

  // Tier 1.5: Invisible same-origin hidden iframes inside sourceTabId (0 tabs, 0 windows).
  const afterIframe = validTabId(sourceTabId)
    ? await runHiddenIframeScan(
        scanId,
        sourceTabId,
        scan,
        afterTier1,
        linksAfterTier1,
        linkListsAfterTier1,
      )
    : Object.freeze({
        remaining: afterTier1,
        unresolvedLinks: linksAfterTier1,
        rateLimited: false,
      });

  if (afterIframe.rateLimited) {
    await markTrackScanReady(scanId, true);

    return;
  }

  if (!afterIframe.remaining.length) {
    await markTrackScanReady(scanId);

    return;
  }

  // Tier 2: Minimized popup window only if framing was blocked or target is cross-origin.
  await startMinimizedWorkerScan(
    scanId,
    afterIframe.remaining,
    afterIframe.unresolvedLinks,
  );
}

async function openMinimizedWorkerTab(startUrl: string): Promise<{
  readonly workerWindowId: number | null;
  readonly workerTabId: number;
} | null> {
  // Chrome rejects state:"minimized" combined with focused:false; omit focused
  // so the popup opens strictly minimized without falling back to main tabs.
  const workerWindow = await chrome.windows
    ?.create?.({
      url: startUrl,
      type: "popup",
      state: "minimized",
    })
    .catch(() => null);

  if (workerWindow?.tabs?.[0]?.id !== undefined) {
    return Object.freeze({
      workerWindowId: workerWindow.id ?? null,
      workerTabId: workerWindow.tabs[0].id,
    });
  }

  return null;
}

/**
 * Opens ONE minimized popup window for items that require live JS execution,
 * re-tries parallel API probing once page-track-probe.js loads, and otherwise
 * steps rapidly in-place with early-exit as soon as each stream arrives.
 */
async function startMinimizedWorkerScan(
  scanId: string,
  unresolvedIndices: readonly number[],
  unresolvedLinks: Record<string, string> = {},
): Promise<void> {
  const scan = await getTrackScan(scanId);

  if (!scan || scan.status !== "scanning" || !unresolvedIndices.length) {
    await markTrackScanReady(scanId);

    return;
  }

  const firstIndex = unresolvedIndices[0];
  const firstTopic = scan.items[firstIndex];
  const firstLinkedUrl = safeMediaUrl(unresolvedLinks[String(firstIndex)]);

  const opened = await openMinimizedWorkerTab(firstLinkedUrl || firstTopic.url);

  if (!opened) {
    await markTrackScanReady(scanId);

    return;
  }

  const { workerWindowId, workerTabId } = opened;

  const isSidebarButtons = scan.items.some((item) =>
    Number.isSafeInteger(item.navigationIndex),
  );

  const rawNavIndex = firstTopic.navigationIndex;

  const navigationIndex =
    typeof rawNavIndex === "number" && Number.isSafeInteger(rawNavIndex)
      ? rawNavIndex
      : null;

  const needsNavigation =
    !firstLinkedUrl && navigationIndex !== null && navigationIndex >= 0;

  const initialProbe: WorkerTabProbe = Object.freeze({
    scanId,
    workerWindowId,
    playlistUrl: scan.items[0]?.url || firstTopic.url,
    unresolvedLinks,
    queue: unresolvedIndices,
    queuePos: 0,
    topicIndex: firstIndex,
    navigationIndex,
    topicTitle: firstTopic.fileTitle,
    topicSection: firstTopic.folderPath.at(-1) || "",
    linkedTitle: "",
    navigated: !needsNavigation,
    navigationStarted: false,
    followedLinkedVideo: Boolean(firstLinkedUrl),
    previousStreamKey: "",
    lastStreamKey: "",
    streamCaptured: false,
    hasSubtitles: false,
    pendingSubtitles: [],
    triedApiEscalation: Boolean(firstLinkedUrl),
    fanoutStarted: false,
    isSidebarButtons,
  });

  await chrome.storage.session.set({
    [probeKey(workerTabId)]: initialProbe,
  });

  const tabsSet = activeScanWorkerTabs.get(scanId) || new Set<number>();

  tabsSet.add(workerTabId);
  activeScanWorkerTabs.set(scanId, tabsSet);

  if (needsNavigation) {
    await chrome.alarms.create(`track-navigate:${workerTabId}`, {
      when: Date.now() + 1200,
    });
  }

  await chrome.alarms.create(`track-probe:${workerTabId}`, {
    when: Date.now() + (needsNavigation ? 10000 : 5500),
  });
}

async function closeWorkerContainer(
  tabId: number,
  workerWindowId: number | null,
): Promise<void> {
  if (workerWindowId !== null && chrome.windows?.remove) {
    await chrome.windows.remove(workerWindowId).catch(() => {});

    return;
  }

  await chrome.tabs.remove(tabId).catch(() => {});
}

async function finishWorkerTab(
  scanId: string,
  tabId: number,
  workerWindowId: number | null,
): Promise<boolean> {
  clearWorkerEarlyAdvance(tabId);
  await chrome.storage.session.remove(probeKey(tabId));
  const tabsSet = activeScanWorkerTabs.get(scanId);

  if (tabsSet) tabsSet.delete(tabId);

  if (tabsSet && tabsSet.size > 0) {
    await chrome.tabs.remove(tabId).catch(() => {});

    return false;
  }

  activeScanWorkerTabs.delete(scanId);
  await closeWorkerContainer(tabId, workerWindowId);

  return true;
}

async function closeWorker(
  tabId: number,
  workerWindowId: number | null,
): Promise<void> {
  clearWorkerEarlyAdvance(tabId);
  await chrome.storage.session.remove(probeKey(tabId));
  await closeWorkerContainer(tabId, workerWindowId);
}

async function triggerProbeNavigation(tabId: number): Promise<void> {
  const probe = await getTabProbe(tabId);

  if (
    !probe ||
    probe.navigated ||
    probe.navigationStarted ||
    (!Number.isSafeInteger(probe.navigationIndex) && !probe.topicTitle)
  ) {
    return;
  }

  await chrome.storage.session.set({
    [probeKey(tabId)]: { ...probe, navigationStarted: true },
  });

  const result = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, {
        type: "navigate-track-sidebar",
        topicIndex: probe.navigationIndex,
        topicTitle: probe.topicTitle || "",
        topicSection: probe.topicSection || "",
      })
      .catch(() => null),
  );

  const latest = await getTabProbe(tabId);

  if (!latest) return;

  if (!result?.ok) {
    await chrome.storage.session.set({
      [probeKey(tabId)]: { ...latest, navigationStarted: false },
    });

    return;
  }

  await chrome.storage.session.set({
    [probeKey(tabId)]: { ...latest, navigated: true },
  });

  await chrome.storage.session.remove(stateKey(tabId));

  await chrome.alarms.create(`track-probe:${tabId}`, {
    when: Date.now() + 4000,
  });
}

async function tryFollowLinkedVideoInWorker(
  tabId: number,
  probe: WorkerTabProbe,
): Promise<boolean> {
  if (probe.streamCaptured || probe.followedLinkedVideo) return false;

  const linked = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, { type: "find-linked-video-in-page" })
      .catch(() => null),
  );

  const linkedUrl = safeMediaUrl(linked?.url);

  if (!linkedUrl && !linked?.clicked) return false;

  await chrome.storage.session.set({
    [probeKey(tabId)]: Object.freeze({
      ...probe,
      followedLinkedVideo: true,
      linkedTitle: typeof linked?.title === "string" ? linked.title : "",
      navigated: true,
      pendingSubtitles: [],
      hasSubtitles: false,
      previousStreamKey: probe.lastStreamKey || probe.previousStreamKey || "",
    }),
  });

  await chrome.storage.session.remove(stateKey(tabId));

  if (linkedUrl) {
    await chrome.tabs.update(tabId, { url: linkedUrl }).catch(() => {});
  }

  await chrome.alarms.create(`track-probe:${tabId}`, {
    when: Date.now() + 5500,
  });

  return true;
}

/**
 * Fans out remaining distinct-URL items across up to WORKER_TAB_CONCURRENCY
 * tabs inside the same minimized popup window. Returns the subset owned by the
 * calling worker tab.
 */
async function fanoutDistinctUrlWorkers(
  tabId: number,
  probe: WorkerTabProbe,
  scan: TrackScan,
  remaining: number[],
  unresolvedLinks: Record<string, string>,
): Promise<number[]> {
  if (
    probe.isSidebarButtons ||
    isTrackPage(probe.playlistUrl) ||
    probe.fanoutStarted ||
    remaining.length <= 1 ||
    probe.workerWindowId === null
  ) {
    return remaining;
  }

  const parallelCount = Math.min(WORKER_TAB_CONCURRENCY, remaining.length);

  const buckets = Array.from({ length: parallelCount }, (_slot, shard) =>
    remaining.filter((_entry, position) => position % parallelCount === shard),
  );

  const tabsSet = activeScanWorkerTabs.get(probe.scanId) || new Set([tabId]);

  activeScanWorkerTabs.set(probe.scanId, tabsSet);
  const overflow: number[] = [];

  for (const shardQueue of buckets.slice(1)) {
    const shardFirstIndex = shardQueue[0];
    const shardTopic = scan.items[shardFirstIndex];

    const shardLinkedUrl = safeMediaUrl(
      unresolvedLinks[String(shardFirstIndex)],
    );

    const extraTab = await chrome.tabs
      .create({
        windowId: probe.workerWindowId,
        url: shardLinkedUrl || shardTopic.url,
        active: false,
      })
      .catch(() => null);

    if (!extraTab?.id) {
      overflow.push(...shardQueue);
      continue;
    }

    tabsSet.add(extraTab.id);

    const shardProbe: WorkerTabProbe = Object.freeze({
      scanId: probe.scanId,
      workerWindowId: probe.workerWindowId,
      playlistUrl: probe.playlistUrl,
      unresolvedLinks,
      queue: shardQueue,
      queuePos: 0,
      topicIndex: shardFirstIndex,
      navigationIndex: null,
      topicTitle: shardTopic.fileTitle,
      topicSection: shardTopic.folderPath.at(-1) || "",
      linkedTitle: "",
      navigated: true,
      navigationStarted: false,
      followedLinkedVideo: Boolean(shardLinkedUrl),
      previousStreamKey: "",
      lastStreamKey: "",
      streamCaptured: false,
      hasSubtitles: false,
      pendingSubtitles: [],
      triedApiEscalation: true,
      fanoutStarted: true,
      isSidebarButtons: false,
    });

    await chrome.storage.session.set({
      [probeKey(extraTab.id)]: shardProbe,
    });

    await chrome.alarms.create(`track-probe:${extraTab.id}`, {
      when: Date.now() + 5000,
    });
  }

  return [...buckets[0], ...overflow];
}

/**
 * Dispatches navigation for the next item in a minimized worker tab using
 * early returns so each branch stays flat and readable.
 */
async function dispatchNextWorkerStep(
  tabId: number,
  probe: WorkerTabProbe,
  nextTopic: TrackTopic,
  nextLinkedUrl: string | null,
  returningFromLinkedPage: boolean,
): Promise<void> {
  if (nextLinkedUrl) {
    await chrome.tabs.update(tabId, { url: nextLinkedUrl }).catch(() => {});

    await chrome.alarms.create(`track-probe:${tabId}`, {
      when: Date.now() + 5500,
    });

    return;
  }

  if (returningFromLinkedPage) {
    await chrome.tabs
      .update(tabId, { url: probe.playlistUrl || nextTopic.url })
      .catch(() => {});

    await chrome.alarms.create(`track-navigate:${tabId}`, {
      when: Date.now() + 1500,
    });

    await chrome.alarms.create(`track-probe:${tabId}`, {
      when: Date.now() + 10000,
    });

    return;
  }

  if (probe.isSidebarButtons) {
    await triggerProbeNavigation(tabId);

    await chrome.alarms.create(`track-probe:${tabId}`, {
      when: Date.now() + 4500,
    });

    return;
  }

  await chrome.tabs.update(tabId, { url: nextTopic.url }).catch(() => {});

  await chrome.alarms.create(`track-probe:${tabId}`, {
    when: Date.now() + 8000,
  });
}

async function attachWorkerDomSubtitles(
  tabId: number,
  probe: WorkerTabProbe,
  scan: TrackScan,
): Promise<void> {
  if (!probe.streamCaptured || probe.hasSubtitles) return;

  const domSubtitles = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, { type: "collect-page-subtitles" })
      .catch(() => null),
  );

  if (!Array.isArray(domSubtitles?.tracks) || !domSubtitles.tracks.length) {
    return;
  }

  const topicText = scan.items[probe.topicIndex]?.fileTitle || "";
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  const resolvedTracks = (
    await Promise.all(
      (domSubtitles.tracks as SubtitleCandidate[]).map((track) =>
        resolveExtraSubtitle(track, tab?.url || "", topicText, tabId),
      ),
    )
  ).filter(isPresent);

  if (resolvedTracks.length) await storeProbeSubtitles(tabId, resolvedTracks);
}

async function attachWorkerDomDocuments(
  tabId: number,
  probe: WorkerTabProbe,
  scan: TrackScan,
): Promise<void> {
  const existing = scan.discovered.find(
    (item) => item.topicIndex === probe.topicIndex,
  );

  if (existing?.documents) return;

  const domDocuments = await extractFrameDocuments(tabId);

  if (!domDocuments) return;

  if (existing) {
    await storeDiscoveredTopic(
      probe.scanId,
      probe.topicIndex,
      { ...existing, documents: domDocuments },
      false,
    );

    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const topicUrl = scan.items[probe.topicIndex]?.url || "";

  await storeDiscoveredTopic(
    probe.scanId,
    probe.topicIndex,
    documentsOnlyStream(
      probe.topicIndex,
      safeMediaUrl(tab?.url) || topicUrl,
      domDocuments,
    ),
    false,
  );
}

async function escalateWorkerProbeQueue(
  tabId: number,
  probe: WorkerTabProbe,
  queuedAfterCurrent: number[],
): Promise<TrackProbeResult> {
  if (!queuedAfterCurrent.length || probe.triedApiEscalation) {
    return Object.freeze({
      ok: false,
      rateLimited: false,
      unresolvedIndices: queuedAfterCurrent,
      unresolvedLinks: {},
      unresolvedLinkLists: {},
    });
  }

  await chrome.storage.session.set({
    [probeKey(tabId)]: Object.freeze({
      ...probe,
      triedApiEscalation: true,
    }),
  });

  return probeTrackTopicsInTab(probe.scanId, tabId, queuedAfterCurrent);
}

/**
 * Advances a minimized worker tab to the next unresolved item, escalating
 * back to parallel headless API probing after the first item loads if the
 * playlist exposes a JSON API.
 */
async function advanceWorkerProbe(tabId: number): Promise<void> {
  clearWorkerEarlyAdvance(tabId);
  const probe = await getTabProbe(tabId);

  if (!probe) return;
  const scan = await getTrackScan(probe.scanId);

  if (!scan || scan.status !== "scanning") {
    await closeWorker(tabId, probe.workerWindowId ?? null);

    return;
  }

  await attachWorkerDomSubtitles(tabId, probe, scan);
  await attachWorkerDomDocuments(tabId, probe, scan);
  if (await tryFollowLinkedVideoInWorker(tabId, probe)) return;
  await incrementCheckedTopicCount(probe.scanId);

  const queuedAfterCurrent = probe.queue.slice(probe.queuePos + 1);

  const escalated = await escalateWorkerProbeQueue(
    tabId,
    probe,
    queuedAfterCurrent,
  );

  const unresolvedLinks = escalated.ok
    ? { ...(probe.unresolvedLinks || {}), ...escalated.unresolvedLinks }
    : { ...(probe.unresolvedLinks || {}) };

  const remainingAfterApi = escalated.ok
    ? escalated.unresolvedIndices
    : queuedAfterCurrent;

  if (!remainingAfterApi.length) {
    const allWorkersDone = await finishWorkerTab(
      probe.scanId,
      tabId,
      probe.workerWindowId ?? null,
    );

    if (allWorkersDone) await markTrackScanReady(probe.scanId);

    return;
  }

  const ownedQueue = await fanoutDistinctUrlWorkers(
    tabId,
    probe,
    scan,
    remainingAfterApi,
    unresolvedLinks,
  );

  const nextTopicIndex = ownedQueue[0];
  const nextTopic = scan.items[nextTopicIndex];
  const nextLinkedUrl = safeMediaUrl(unresolvedLinks[String(nextTopicIndex)]);
  const rawNextNavIndex = nextTopic.navigationIndex;

  const nextNavIndex =
    typeof rawNextNavIndex === "number" && Number.isSafeInteger(rawNextNavIndex)
      ? rawNextNavIndex
      : null;

  const returningFromLinkedPage =
    Boolean(probe.followedLinkedVideo) &&
    probe.isSidebarButtons &&
    !nextLinkedUrl;

  await chrome.storage.session.set({
    [probeKey(tabId)]: Object.freeze({
      ...probe,
      unresolvedLinks,
      queue: ownedQueue,
      queuePos: 0,
      topicIndex: nextTopicIndex,
      navigationIndex: nextNavIndex,
      topicTitle: nextTopic.fileTitle,
      topicSection: nextTopic.folderPath.at(-1) || "",
      linkedTitle: "",
      previousStreamKey: probe.lastStreamKey || probe.previousStreamKey || "",
      streamCaptured: false,
      hasSubtitles: false,
      pendingSubtitles: [],
      triedApiEscalation: true,
      fanoutStarted: true,
      followedLinkedVideo: Boolean(nextLinkedUrl),
      navigated: Boolean(nextLinkedUrl) || !probe.isSidebarButtons,
      navigationStarted: false,
    }),
  });

  await chrome.storage.session.remove(stateKey(tabId));

  await dispatchNextWorkerStep(
    tabId,
    probe,
    nextTopic,
    nextLinkedUrl,
    returningFromLinkedPage,
  );
}

async function fetchMediaResponse(
  safeUrl: string,
  sourceUrl: string,
  method: "GET" | "HEAD" = "GET",
): Promise<Response | null> {
  const baseInit = createMediaRequest({
    mediaUrl: safeUrl,
    sourcePageUrl: sourceUrl,
  });

  const attempts: readonly RequestInit[] = [
    { ...baseInit, method, redirect: "follow" },
    { cache: "no-store", credentials: "omit", method, redirect: "follow" },
  ];

  for (const init of attempts) {
    try {
      const response = await fetch(safeUrl, init);

      if (response.url && !safeMediaUrl(response.url)) continue;
      if (response.ok) return response;

      if (
        method === "HEAD" &&
        (response.status === 405 || response.status === 501)
      ) {
        return response;
      }
    } catch {
      // Retry with credentials omitted for wildcard-ACAO CDNs.
    }
  }

  return null;
}

async function inspectPlaylist(
  url: string,
  sourceUrl = "",
  sourceTabId: number | null = null,
): Promise<HlsMasterMetadata> {
  const safeUrl = safeMediaUrl(url);

  if (!safeUrl) throw new Error("Unsafe playlist URL.");

  const response = await fetchMediaResponse(safeUrl, sourceUrl, "GET");

  if (response) {
    const resolvedUrl =
      (response.url ? safeMediaUrl(response.url) : null) || safeUrl;

    return playlistMetadata(await response.text(), resolvedUrl);
  }

  if (validTabId(sourceTabId) && isTrackPage(sourceUrl)) {
    const pageResponse = await fetchFromTrackPage(
      sourceTabId,
      safeUrl,
      "text",
      3500,
    ).catch(() => null);

    if (
      pageResponse &&
      pageResponse.status >= 200 &&
      pageResponse.status < 300 &&
      pageResponse.body
    ) {
      return playlistMetadata(pageResponse.body, safeUrl);
    }
  }

  throw new Error("Playlist request failed.");
}

async function probeVariant(
  url: string,
  sourceUrl: string,
): Promise<string | null> {
  const safeUrl = safeMediaUrl(url);

  if (!safeUrl) return null;

  const head = await fetchMediaResponse(safeUrl, sourceUrl, "HEAD");

  if (head?.ok) return safeUrl;

  if (head && head.status !== 405 && head.status !== 501) return null;

  const response = await fetchMediaResponse(safeUrl, sourceUrl, "GET");

  return response?.ok ? safeUrl : null;
}

async function findAvailableQualityOptions(
  playlistUrl: string,
  sourceUrl: string,
): Promise<VideoQualityOption[]> {
  const available = await Promise.all(
    numericQualityOptions(playlistUrl).map(async (candidate) =>
      (await probeVariant(candidate.url, sourceUrl)) ? candidate : null,
    ),
  );

  return available.filter(isPresent);
}

async function capturedInHiddenFrame(
  details: chrome.webRequest.OnCompletedDetails,
): Promise<boolean> {
  const frameProbe = resolveHiddenFrameProbe(
    details.tabId,
    details.frameId,
    details.parentFrameId,
  );

  if (!frameProbe) return false;

  const built = await buildProbedStream(
    details.url,
    frameProbe.sourceUrl,
    [],
    frameProbe.ruleId,
    frameProbe.topicTitle,
    details.tabId,
  );

  if (built) frameProbe.onStream(built);

  return true;
}

async function recordPlaylist(
  details: chrome.webRequest.OnCompletedDetails,
): Promise<void> {
  const isHls = playlistKind(details.url);

  const isDirect =
    Boolean(safeMediaUrl(details.url)) && isDirectVideoUrl(details.url);

  if (
    details.tabId < 0 ||
    details.statusCode < 200 ||
    details.statusCode >= 400 ||
    (!isHls && !isDirect)
  ) {
    return;
  }

  if (await capturedInHiddenFrame(details)) return;

  if (!isHls) return;

  const tab = await chrome.tabs.get(details.tabId).catch(() => null);

  const { playlistUrl: detectedUrl, metadata } =
    await inspectAuthorizedPlaylist(
      details.url,
      tab?.url || "",
      mediaAuthorizationRuleId,
      details.tabId,
    );

  const state = await synchronizePageState(details.tabId, tab?.url || "");
  const key = streamIdentity(detectedUrl) || detectedUrl;

  const existing = state.streams.find(
    (item) => (streamIdentity(item.url) || item.key || item.url) === key,
  );

  const detectedQualityOption = metadata.isMaster
    ? null
    : directQualityOption(details.url);

  const playerQualityOptions =
    existing || (metadata.isMaster && metadata.qualityOptions.length)
      ? []
      : await findAvailableQualityOptions(detectedUrl, tab?.url || "");

  const qualityOptions = uniqueQualityOptions(
    [
      ...metadata.qualityOptions,
      detectedQualityOption,
      ...playerQualityOptions,
    ].filter(isPresent),
  );

  const latestState = await enqueueDetection(() =>
    synchronizePageState(details.tabId, tab?.url || ""),
  );

  const latestExisting = latestState.streams.find(
    (item) => (streamIdentity(item.url) || item.key || item.url) === key,
  );

  if (latestExisting) {
    const mergedQualityOptions = uniqueQualityOptions([
      ...latestExisting.qualityOptions,
      ...qualityOptions,
    ]);

    const mergedSubtitles = [
      ...latestExisting.subtitles,
      ...metadata.subtitles,
    ].filter(
      (track, index, all) =>
        all.findIndex((item) => item.url === track.url) === index,
    );

    const updated: ProbedStream = {
      ...latestExisting,
      url: metadata.isMaster ? detectedUrl : latestExisting.url,
      kind: metadata.isMaster ? "master" : latestExisting.kind,
      qualityOptions: mergedQualityOptions,
      subtitles: mergedSubtitles,
    };

    const nextStreams = [
      updated,
      ...latestState.streams.filter(
        (stream) =>
          (streamIdentity(stream.url) || stream.key || stream.url) !== key,
      ),
    ];

    await enqueueDetection(() =>
      setState(details.tabId, { ...latestState, streams: nextStreams }),
    );

    await storeProbedStream(details.tabId, updated);

    return;
  }

  const headingResponse = externalRecord(
    await chrome.tabs
      .sendMessage(details.tabId, { type: "get-page-heading" })
      .catch(() => null),
  );

  const pageHeading =
    typeof headingResponse?.title === "string"
      ? boundedText(headingResponse.title, 240).trim()
      : "";

  const item: ProbedStream = {
    key,
    url: detectedUrl,
    host: new URL(details.url).host,
    title: pageHeading || tab?.title || "Detected HLS manifest",
    sourceUrl: tab?.url || "",
    kind: metadata.isMaster ? "master" : "media",
    qualityOptions,
    subtitles: metadata.subtitles,
    detectedAt: Date.now(),
  };

  const nextStreams = [
    item,
    ...latestState.streams.filter(
      (stream) =>
        (streamIdentity(stream.url) || stream.key || stream.url) !== key,
    ),
  ].slice(0, 25);

  await enqueueDetection(() =>
    setState(details.tabId, { ...latestState, streams: nextStreams }),
  );

  await storeProbedStream(details.tabId, item);
}

async function mergeSubtitlesIntoTabState(
  tabId: number,
  pageUrl: string,
  tracks: readonly SubtitleTrack[],
): Promise<SubtitleTrack[]> {
  if (!tracks.length) return [];

  return enqueueDetection(async () => {
    const state = await synchronizePageState(tabId, pageUrl);

    const newTracks = tracks.filter(
      (track) =>
        !state.subtitles.some((existing) => existing.url === track.url),
    );

    const updatedSubtitles = [...newTracks, ...state.subtitles].slice(0, 20);

    if (newTracks.length) {
      await setState(tabId, { ...state, subtitles: updatedSubtitles });
    }

    return updatedSubtitles;
  });
}

async function recordSubtitle(
  details: chrome.webRequest.OnCompletedDetails,
): Promise<void> {
  if (
    details.tabId < 0 ||
    details.statusCode < 200 ||
    details.statusCode >= 400 ||
    !subtitleKind(details.url)
  ) {
    return;
  }

  const frameProbe = resolveHiddenFrameProbe(
    details.tabId,
    details.frameId,
    details.parentFrameId,
  );

  if (frameProbe) {
    const track = await resolveExtraSubtitle(
      details.url,
      frameProbe.sourceUrl,
      frameProbe.topicTitle,
      details.tabId,
    );

    if (track) frameProbe.onSubtitles([track]);

    return;
  }

  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  const currentState = await getState(details.tabId);

  if (
    currentState.pageUrl === (tab?.url || "") &&
    currentState.subtitles.some((item) => item.url === details.url)
  ) {
    return;
  }

  const subtitle = await inspectSubtitle(
    details.url,
    tab?.title || "",
    tab?.url || "",
    details.tabId,
  );

  if (!subtitle) return;

  const resolvedUrl = subtitle.resolvedUrl || details.url;
  const filename = new URL(resolvedUrl).pathname.split("/").pop() || "";

  const track: SubtitleTrack = Object.freeze({
    url: resolvedUrl,
    label: filename,
    language: subtitle.language,
  });

  await mergeSubtitlesIntoTabState(details.tabId, tab?.url || "", [track]);
  await storeProbeSubtitles(details.tabId, [track]);
}

async function recordPageSubtitles(
  tabId: number,
  reported: ExternalValue,
  frameId = 0,
): Promise<void> {
  const frameProbe = hiddenFrameProbes.get(hiddenFrameKey(tabId, frameId));

  if (frameProbe) {
    const tracks = (
      await Promise.all(
        knownSubtitleTracksFromPage(reported).map((candidate) =>
          resolveExtraSubtitle(
            candidate,
            frameProbe.sourceUrl,
            frameProbe.topicTitle,
            tabId,
          ),
        ),
      )
    ).filter(isPresent);

    if (tracks.length) frameProbe.onSubtitles(tracks);

    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);

  const resolvedTracks = (
    await Promise.all(
      knownSubtitleTracksFromPage(reported).map((candidate) =>
        resolveExtraSubtitle(
          candidate,
          tab?.url || "",
          tab?.title || "",
          tabId,
        ),
      ),
    )
  ).filter(isPresent);

  if (!resolvedTracks.length) return;

  await mergeSubtitlesIntoTabState(tabId, tab?.url || "", resolvedTracks);
  await storeProbeSubtitles(tabId, resolvedTracks);
}

async function collectActiveTabSubtitles(
  tabId: number,
  pageUrl: string,
  tabTitle: string,
  existingSubtitles: readonly SubtitleTrack[],
): Promise<SubtitleTrack[]> {
  const response = externalRecord(
    await chrome.tabs
      .sendMessage(tabId, { type: "collect-page-subtitles" })
      .catch(() => null),
  );

  const candidates = knownSubtitleTracksFromPage(response?.tracks).filter(
    (candidate) =>
      !existingSubtitles.some((existing) => existing.url === candidate.url),
  );

  if (!candidates.length) return [];

  const resolved = (
    await Promise.all(
      candidates.map((candidate) =>
        resolveExtraSubtitle(candidate, pageUrl, tabTitle, tabId),
      ),
    )
  ).filter(isPresent);

  if (resolved.length) {
    await mergeSubtitlesIntoTabState(tabId, pageUrl, resolved);
  }

  return resolved;
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    recordPlaylist(details).catch(() => {});
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    recordSubtitle(details).catch(() => {});
  },
  { urls: ["<all_urls>"] },
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  clearWorkerEarlyAdvance(tabId);

  await chrome.storage.session.remove([
    stateKey(tabId),
    outlineKey(tabId),
    probeKey(tabId),
  ]);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    triggerProbeNavigation(tabId).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const navigationMatch = /^track-navigate:(\d+)$/.exec(alarm.name);

  if (navigationMatch) {
    triggerProbeNavigation(Number(navigationMatch[1])).catch(() => {});

    return;
  }

  const match = /^track-probe:(\d+)$/.exec(alarm.name);

  if (match) advanceWorkerProbe(Number(match[1])).catch(() => {});
});

const extensionOrigin = chrome.runtime.getURL("");

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const filename =
    pendingDownloadTargets.get(item.url) ||
    (pendingDownloadTargets.size === 1
      ? [...pendingDownloadTargets.values()][0]
      : null);

  if (!filename) {
    suggest();

    return;
  }

  pendingDownloadTargets.delete(item.url);
  suggest({ filename, conflictAction: "uniquify" });
});

const extensionOnlyMessages = new Set([
  "list-detections",
  "clear-detections",
  "open-download",
  "authorize-download-media",
  "register-download-target",
  "release-download-target",
  "take-download-request",
  "fetch-source-media",
  "start-track-scan",
  "get-track-scan",
  "open-track-download",
  "take-track-download",
  "complete-track-download-topic",
  "update-track-download-preferences",
  "set-download-tab-keepalive",
  "export-diagram-svg",
  "export-slides-pdf",
]);

function resolveActiveHeadlessProbe(
  message: ExternalRecord,
  sender: chrome.runtime.MessageSender,
): ActiveHeadlessProbe | null {
  if (
    sender.tab?.id === undefined ||
    !isTrustedTrackFrameSender(sender, chrome.runtime.id)
  ) {
    return null;
  }

  const requestId =
    typeof message.requestId === "string" ? message.requestId : "";

  const active = activeHeadlessProbes.get(requestId);

  if (
    !active ||
    active.tabId !== sender.tab.id ||
    active.frameId !== (sender.frameId ?? 0)
  ) {
    return null;
  }

  return active;
}

function topicsFromOutline(
  outlineRecord: ExternalRecord | null,
  limit?: number,
): readonly TrackTopic[] {
  const rawTopics = Array.isArray(outlineRecord?.items)
    ? outlineRecord.items
    : [];

  const validTopics = rawTopics.filter((item): item is TrackTopicInput =>
    Boolean(safeMediaUrl(externalRecord(item)?.url)),
  );

  return usableTrackTopics(
    limit !== undefined ? validTopics.slice(0, limit) : validTopics,
  );
}

function handleOpenTrackDownload(
  message: ExternalRecord,
  sendResponse: RuntimeMessageResponse,
): boolean {
  getTrackScan(String(message.scanId))
    .then(async (scan) => {
      if (!scan?.discovered?.length) {
        throw new Error("No stream topics are ready to download.");
      }

      const selectedSet = Array.isArray(message.selectedTopicIndices)
        ? new Set(
            message.selectedTopicIndices.filter(
              (value): value is number =>
                typeof value === "number" && Number.isSafeInteger(value),
            ),
          )
        : null;

      const selectedTopics = [...scan.discovered]
        .sort((left, right) => left.topicIndex - right.topicIndex)
        .filter((item) => !selectedSet || selectedSet.has(item.topicIndex));

      if (!selectedTopics.length) {
        throw new Error("Select at least one topic to download.");
      }

      const trackDownloadMode = trackDownloadModeOrDefault(
        message.trackDownloadMode,
      );

      const queuedTopics = selectedTopics.filter((item) =>
        isTopicDownloadableForMode(item, trackDownloadMode),
      );

      if (!queuedTopics.length) {
        throw new Error(
          "No downloadable topic documents or streams were found.",
        );
      }

      const trackDownloadId = crypto.randomUUID();

      await chrome.storage.session.set({
        [`track-download:${trackDownloadId}`]: {
          title: scan.title,
          items: queuedTopics,
          sourceTabId: scan.sourceTabId ?? null,
          completedTopicIndices: [],
          trackDownloadMode,
          outputFormat: outputFormatOrDefault(
            typeof message.outputFormat === "string"
              ? message.outputFormat
              : DEFAULT_DOWNLOAD_PREFERENCES.outputFormat,
          ),
          trackQualityPreference: trackQualityPreferenceOrDefault(
            typeof message.trackQualityPreference === "string"
              ? message.trackQualityPreference
              : DEFAULT_DOWNLOAD_PREFERENCES.trackQualityPreference,
          ),
          subtitleDownloadPreference: subtitleDownloadPreferenceOrDefault(
            typeof message.subtitleDownloadPreference === "string"
              ? message.subtitleDownloadPreference
              : DEFAULT_DOWNLOAD_PREFERENCES.subtitleDownloadPreference,
          ),
          segmentConcurrency: clampConcurrency(
            Number(message.segmentConcurrency) || DEFAULT_SEGMENT_CONCURRENCY,
          ),
        },
      });

      await chrome.tabs.create({
        url: chrome.runtime.getURL(`src/index.html?track=${trackDownloadId}`),
      });

      sendResponse({ ok: true });
    })
    .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));

  return true;
}

function pauseMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runExcalidrawSvgExport(): Promise<
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly error: string }
> {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const waitUntil = async <T>(
    probe: () => T | null | undefined,
    timeoutMs: number,
  ): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const found = probe();

      if (found !== null && found !== undefined) return found;
      await sleep(100);
    }

    return null;
  };

  const waitElement = async (
    selector: string,
    missingError: string,
  ): Promise<HTMLElement> => {
    const element = await waitUntil(
      () => document.querySelector<HTMLElement>(selector),
      10000,
    );

    if (!element) throw new Error(missingError);

    return element;
  };

  const findGuestButton = (): HTMLButtonElement | null =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"], button',
      ),
    ).find((button) => /join as a guest/i.test(button.textContent || "")) ||
    null;

  const findMenuTrigger = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-testid="main-menu-trigger"]');

  const readSvgChunk = async (chunk: unknown): Promise<string> => {
    const raw =
      chunk && typeof chunk === "object" && "data" in chunk
        ? (chunk as { readonly data: unknown }).data
        : chunk;

    if (raw instanceof Blob) return raw.text();

    if (typeof raw === "string") return raw;

    return new TextDecoder().decode(raw as BufferSource);
  };

  const selectOneXScale = (): void => {
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="exportScale"]',
      ),
    );

    const matchRadio =
      radios.find((radio) => {
        const label =
          radio.closest("label")?.textContent ||
          radio.getAttribute("aria-label") ||
          radio.parentElement?.textContent ||
          radio.value ||
          "";

        return /\b1\s*[\u00d7x]\b/i.test(label.trim()) || radio.value === "1";
      }) || radios[0];

    if (matchRadio && !matchRadio.checked) matchRadio.click();
  };

  const ready = await waitUntil(
    () => findGuestButton() || findMenuTrigger(),
    15000,
  );

  if (!ready) {
    return { ok: false, error: "Excalidraw menu did not load." };
  }

  const guestButton = findGuestButton();

  if (guestButton) {
    guestButton.click();
    const menuReady = await waitUntil(findMenuTrigger, 15000);

    if (!menuReady) {
      return {
        ok: false,
        error: "Excalidraw menu did not appear after guest join.",
      };
    }
  }

  await sleep(600);

  const captured = { svg: "" };
  const capturedBlobs = new Map<string, Blob>();

  const recordSvg = (text: string): void => {
    if (text.includes("<svg") && text.includes("</svg>")) {
      captured.svg = text;
    }
  };

  const win = window as unknown as {
    showSaveFilePicker?: (options?: unknown) => Promise<unknown>;
  };

  const hasPicker = typeof win.showSaveFilePicker === "function";
  const origPicker = win.showSaveFilePicker;
  const origCreateObjectUrl = URL.createObjectURL.bind(URL);
  const origAnchorClick = HTMLAnchorElement.prototype.click;

  win.showSaveFilePicker = async () => {
    const chunks: string[] = [];

    return {
      name: "diagram.svg",
      createWritable: async () => ({
        write: async (chunk: unknown) => {
          chunks.push(await readSvgChunk(chunk));
          recordSvg(chunks.join(""));
        },
        close: async () => {
          recordSvg(chunks.join(""));
        },
      }),
    };
  };

  URL.createObjectURL = (resource: Blob | MediaSource): string => {
    const url = origCreateObjectUrl(resource);

    if (resource instanceof Blob) {
      capturedBlobs.set(url, resource);

      resource
        .text()
        .then(recordSvg)
        .catch(() => {});
    }

    return url;
  };

  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    const blob = capturedBlobs.get(this.href);

    if (
      blob &&
      (blob.type.includes("svg") || /\.svg$/i.test(this.download || ""))
    ) {
      blob
        .text()
        .then(recordSvg)
        .catch(() => {});

      return;
    }

    origAnchorClick.call(this);
  };

  try {
    const menuTrigger = await waitElement(
      '[data-testid="main-menu-trigger"]',
      "Excalidraw main menu not found.",
    );

    menuTrigger.click();

    const exportButton = await waitElement(
      '[data-testid="image-export-button"]',
      "Excalidraw export button not found.",
    );

    exportButton.click();

    const exportSvgButton = await waitElement(
      'button[aria-label="Export to SVG"]',
      "Excalidraw SVG export button not found.",
    );

    selectOneXScale();
    exportSvgButton.click();

    const svg = await waitUntil(() => captured.svg || null, 15000);

    return svg
      ? { ok: true, svg }
      : { ok: false, error: "Timed out waiting for Excalidraw SVG export." };
  } catch (error: unknown) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not export Excalidraw SVG.",
    };
  } finally {
    if (hasPicker) win.showSaveFilePicker = origPicker;
    if (!hasPicker) delete win.showSaveFilePicker;
    URL.createObjectURL = origCreateObjectUrl;
    HTMLAnchorElement.prototype.click = origAnchorClick;
  }
}

function waitForExportFrame(
  token: string,
  tabId: number,
  timeoutMs = 15000,
): Promise<number | null> {
  const ready = readyExportFrames.get(token);

  if (ready && ready.tabId === tabId) return Promise.resolve(ready.frameId);

  return new Promise((resolve) => {
    const state = { settled: false };

    const settle = (frameId: number | null): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timer);
      pendingExportFrames.delete(token);
      resolve(frameId);
    };

    const timer = setTimeout(() => settle(null), timeoutMs);

    pendingExportFrames.set(token, { tabId, timer, resolve: settle });
  });
}

function recordReadyExportFrame(
  token: string,
  tabId: number,
  frameId: number,
): void {
  const cutoff = Date.now() - 120000;

  for (const [key, entry] of readyExportFrames.entries()) {
    if (entry.recordedAt < cutoff) readyExportFrames.delete(key);
  }

  readyExportFrames.set(token, { tabId, frameId, recordedAt: Date.now() });
  const pending = pendingExportFrames.get(token);

  if (pending && pending.tabId === tabId) pending.resolve(frameId);
}

function handleExportFrameReady(
  message: ExternalRecord,
  sender: chrome.runtime.MessageSender,
  sendResponse: RuntimeMessageResponse,
  tokenPrefix: string,
  allowedUrl: (rawUrl: string) => boolean,
): false {
  const token = message.token;

  if (
    sender.id === chrome.runtime.id &&
    validTabId(sender.tab?.id) &&
    typeof sender.tab?.url === "string" &&
    sender.tab.url.startsWith(extensionOrigin) &&
    typeof sender.frameId === "number" &&
    Number.isSafeInteger(sender.frameId) &&
    sender.frameId > 0 &&
    allowedUrl(sender.url || "") &&
    typeof token === "string" &&
    token.startsWith(tokenPrefix)
  ) {
    recordReadyExportFrame(token, sender.tab.id, sender.frameId);
    sendResponse({ ok: true });

    return false;
  }

  sendResponse({ ok: false });

  return false;
}

function cleanupExportFrame(frameToken: string): void {
  const pending = pendingExportFrames.get(frameToken);

  if (pending) {
    clearTimeout(pending.timer);
    pendingExportFrames.delete(frameToken);
  }

  readyExportFrames.delete(frameToken);
}

async function runExportFrameScript<T>(
  tabId: number,
  initialFrameId: number,
  frameToken: string,
  func: () => Promise<T>,
): Promise<unknown> {
  const firstRun = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [initialFrameId] },
    world: "MAIN",
    func,
  });

  if (firstRun?.[0]?.result !== undefined && firstRun?.[0]?.result !== null) {
    return firstRun[0].result;
  }

  await pauseMs(350);
  const currentFrameId = readyExportFrames.get(frameToken)?.frameId;
  const retryFrameId = currentFrameId ?? initialFrameId;

  const secondRun = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [retryFrameId] },
    world: "MAIN",
    func,
  });

  return secondRun?.[0]?.result;
}

async function exportExcalidrawSvg(
  rawUrl: string,
  senderTabId?: number,
  frameToken = "",
): Promise<
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly error: string }
> {
  const safeUrl = safeMediaUrl(rawUrl);

  if (!safeUrl || !isExcalidrawUrl(safeUrl)) {
    return { ok: false, error: "Invalid Excalidraw diagram URL." };
  }

  if (
    !validTabId(senderTabId) ||
    !frameToken.startsWith(DIAGRAM_FRAME_PREFIX)
  ) {
    return { ok: false, error: "Could not locate hidden Excalidraw frame." };
  }

  try {
    const frameId = await waitForExportFrame(frameToken, senderTabId, 15000);

    if (frameId === null || !Number.isSafeInteger(frameId) || frameId <= 0) {
      return {
        ok: false,
        error: "Hidden Excalidraw frame did not register in time.",
      };
    }

    const rawOutcome = await runExportFrameScript(
      senderTabId,
      frameId,
      frameToken,
      runExcalidrawSvgExport,
    );

    const outcome = externalRecord(rawOutcome);
    const svg = typeof outcome?.svg === "string" ? outcome.svg : "";

    if (
      outcome?.ok === true &&
      svg.includes("<svg") &&
      svg.includes("</svg>")
    ) {
      return { ok: true, svg };
    }

    const reason =
      typeof outcome?.error === "string" && outcome.error
        ? outcome.error
        : "Excalidraw SVG export produced invalid output.";

    return { ok: false, error: reason };
  } catch (error: unknown) {
    return {
      ok: false,
      error: errorMessage(error, "Could not export Excalidraw diagram."),
    };
  } finally {
    cleanupExportFrame(frameToken);
  }
}

async function runHeadlessSlidesCapture(): Promise<
  | { readonly ok: true; readonly frames: readonly string[] }
  | { readonly ok: false; readonly error: string }
> {
  const WIDTH = 1440;
  const HEIGHT = 810;

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const fetchAsDataUrl = async (url: string): Promise<string | null> => {
    try {
      const resp = await fetch(url);

      if (!resp.ok) return null;

      return await blobToDataUrl(await resp.blob());
    } catch {
      return null;
    }
  };

  const stripUnusedFontFaces = (css: string): string =>
    css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
      const ur = /unicode-range\s*:([^;]+)/i.exec(block);

      if (!ur) return block;

      return /U\+0000|U\+0020|U\+00-FF|U\+00A0/i.test(ur[1]) ? block : "";
    });

  const collectCssUrlTokens = (
    filtered: string,
    baseUrl: string,
  ): Map<string, string[]> => {
    const matches = [...filtered.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)];
    const unique = new Map<string, string[]>();

    for (const match of matches) {
      const raw = match[2].trim();

      if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;

      const resolved = new URL(raw, baseUrl).href;
      const list = unique.get(resolved) ?? [];

      list.push(match[0]);
      unique.set(resolved, list);
    }

    return unique;
  };

  const inlineCssUrls = async (
    cssText: string,
    baseUrl: string,
  ): Promise<string> => {
    const filtered = stripUnusedFontFaces(cssText);
    const unique = collectCssUrlTokens(filtered, baseUrl);

    const entries = await Promise.all(
      [...unique.entries()].map(
        async ([resolved, tokens]): Promise<
          readonly [string[], string | null]
        > => [tokens, await fetchAsDataUrl(resolved)],
      ),
    );

    const out = { css: filtered };

    for (const [tokens, dataUrl] of entries) {
      if (!dataUrl) continue;

      for (const token of tokens) {
        out.css = out.css.split(token).join(`url("${dataUrl}")`);
      }
    }

    return out.css;
  };

  const fetchStyleElementCss = async (el: Element): Promise<string> => {
    if (el.tagName === "STYLE") {
      return inlineCssUrls(el.textContent || "", location.href);
    }

    const href = el.getAttribute("href");

    if (!href) return "";

    try {
      const abs = new URL(href, location.href).href;
      const resp = await fetch(abs);

      return resp.ok ? await inlineCssUrls(await resp.text(), abs) : "";
    } catch {
      return "";
    }
  };

  const collectCombinedCss = async (): Promise<string> => {
    const elements = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]'),
    );

    const styleParts = await Promise.all(elements.map(fetchStyleElementCss));

    styleParts.push(
      "*, *::before, *::after { transition: none !important; animation: none !important; }",
      '#hint, .hint, #prev, #next, #tap-prev, #tap-next, .controls, .nav-controls, #progress, .progress-bar, [data-testid="slide-controls"] { opacity: 0 !important; pointer-events: none !important; }',
      `html, body { width: ${WIDTH}px !important; height: ${HEIGHT}px !important; overflow: hidden !important; }`,
    );

    return styleParts.join("\n");
  };

  const collectImageDataUrls = async (): Promise<
    Map<string, string | null>
  > => {
    const imgCache = new Map<string, string | null>();
    const imgs = Array.from(document.querySelectorAll("img"));

    const urls = Array.from(
      new Set(
        imgs
          .map((img) => img.currentSrc || img.src)
          .filter((src) => Boolean(src) && !src.startsWith("data:")),
      ),
    );

    await Promise.all(
      urls.map(async (src) => {
        imgCache.set(src, await fetchAsDataUrl(src));
      }),
    );

    return imgCache;
  };

  const settleFrames = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 40));

  const resetHomeSlide = async (
    slideEls: NodeListOf<Element>,
  ): Promise<void> => {
    if (slideEls[0].classList.contains("active")) return;

    (document.body || document.documentElement).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        code: "Home",
        keyCode: 36,
        which: 36,
        bubbles: true,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    if (!slideEls[0].classList.contains("active")) {
      Array.from(slideEls).forEach((slide, idx) =>
        slide.classList.toggle("active", idx === 0),
      );
    }

    await settleFrames();
  };

  const detectDeck = async (): Promise<{
    readonly count: number;
    readonly deckType: "slide" | "reveal" | "single";
  }> => {
    const slideEls = document.querySelectorAll(".slide");

    if (slideEls.length > 0) {
      await resetHomeSlide(slideEls);

      return { count: Math.min(slideEls.length, 150), deckType: "slide" };
    }

    const revealEls = document.querySelectorAll(".reveal .slides > section");

    if (revealEls.length > 0) {
      return { count: Math.min(revealEls.length, 150), deckType: "reveal" };
    }

    return { count: 1, deckType: "single" };
  };

  const dispatchRightKey = (): void => {
    (document.body || document.documentElement).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        keyCode: 39,
        which: 39,
        bubbles: true,
      }),
    );
  };

  const advanceSlide = async (
    targetIndex: number,
    deckType: "slide" | "reveal" | "single",
  ): Promise<void> => {
    if (targetIndex <= 0 || deckType === "single") return;

    if (deckType === "reveal") {
      const reveal = (
        window as unknown as {
          readonly Reveal?: { readonly slide?: (index: number) => void };
        }
      ).Reveal;

      if (typeof reveal?.slide === "function") {
        reveal.slide(targetIndex);
        await settleFrames();

        return;
      }

      dispatchRightKey();
      await settleFrames();

      return;
    }

    const slides = Array.from(document.querySelectorAll(".slide"));
    const nextButton = document.getElementById("next");

    if (nextButton) nextButton.click();
    if (!nextButton) dispatchRightKey();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const activeIndex = slides.findIndex((slide) =>
      slide.classList.contains("active"),
    );

    if (activeIndex !== targetIndex) {
      slides.forEach((slide, idx) =>
        slide.classList.toggle("active", idx === targetIndex),
      );
    }

    await settleFrames();
  };

  const inlineClonedImages = (
    clone: Element,
    imgCache: Map<string, string | null>,
  ): void => {
    for (const img of clone.querySelectorAll("img")) {
      const rawSrc = img.getAttribute("src") || "";

      if (!rawSrc || rawSrc.startsWith("data:")) continue;

      try {
        const abs = new URL(rawSrc, location.href).href;
        const dataUrl = imgCache.get(abs);

        if (dataUrl) img.setAttribute("src", dataUrl);
      } catch {
        continue;
      }
    }
  };

  const captureSlideJpeg = async (
    combinedCss: string,
    imgCache: Map<string, string | null>,
  ): Promise<string> => {
    const clone = document.documentElement.cloneNode(true) as Element;

    for (const node of clone.querySelectorAll(
      "script, style, link[rel='stylesheet'], link[rel='preconnect']",
    )) {
      node.remove();
    }

    const styleEl = document.createElement("style");

    styleEl.textContent = combinedCss;
    (clone.querySelector("head") || clone).appendChild(styleEl);
    inlineClonedImages(clone, imgCache);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not rasterize slide SVG."));
      img.src = svgUrl;
    });

    const canvas = document.createElement("canvas");

    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx2d = canvas.getContext("2d");

    if (!ctx2d) throw new Error("Could not acquire 2D canvas for slide.");

    ctx2d.fillStyle =
      getComputedStyle(document.body).backgroundColor || "#000000";

    ctx2d.fillRect(0, 0, WIDTH, HEIGHT);
    ctx2d.drawImage(image, 0, 0, WIDTH, HEIGHT);

    return canvas.toDataURL("image/jpeg", 0.92);
  };

  try {
    await document.fonts.ready.catch(() => {});

    const [combinedCss, imgCache] = await Promise.all([
      collectCombinedCss(),
      collectImageDataUrls(),
    ]);

    const deck = await detectDeck();
    const frames: string[] = [];

    for (
      const cursor = { index: 0 };
      cursor.index < deck.count;
      cursor.index += 1
    ) {
      if (cursor.index > 0) await advanceSlide(cursor.index, deck.deckType);
      frames.push(await captureSlideJpeg(combinedCss, imgCache));
    }

    return { ok: true, frames };
  } catch (error: unknown) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not capture slides headlessly.",
    };
  }
}

async function exportSlidesToPdf(
  rawUrl: string,
  senderTabId?: number,
  frameToken = "",
): Promise<
  | {
      readonly ok: true;
      readonly pdfBase64: string;
      readonly pageCount: number;
    }
  | { readonly ok: false; readonly error: string }
> {
  const safeUrl = safeMediaUrl(rawUrl);

  if (!safeUrl) {
    return { ok: false, error: "Invalid slides URL." };
  }

  if (!validTabId(senderTabId) || !frameToken.startsWith(SLIDES_FRAME_PREFIX)) {
    return { ok: false, error: "Could not locate hidden slides frame." };
  }

  try {
    const frameId = await waitForExportFrame(frameToken, senderTabId, 15000);

    if (frameId === null || !Number.isSafeInteger(frameId) || frameId <= 0) {
      return {
        ok: false,
        error: "Hidden slides frame did not register in time.",
      };
    }

    const rawOutcome = await runExportFrameScript(
      senderTabId,
      frameId,
      frameToken,
      runHeadlessSlidesCapture,
    );

    const outcome = externalRecord(rawOutcome);

    const rawFrames = Array.isArray(outcome?.frames)
      ? outcome.frames.filter(
          (item): item is string =>
            typeof item === "string" && item.startsWith("data:image/"),
        )
      : [];

    if (outcome?.ok !== true || !rawFrames.length) {
      const reason =
        typeof outcome?.error === "string" && outcome.error
          ? outcome.error
          : "Headless slide capture produced no frames.";

      return { ok: false, error: reason };
    }

    const pages: PdfJpegPage[] = rawFrames.map((dataUrl) => {
      const base64 = dataUrl.replace(/^data:image\/jpe?g;base64,/i, "");
      const bytes = bytesFromBase64(base64);

      const dimensions = jpegDimensions(bytes) || {
        width: 1440,
        height: 810,
      };

      return Object.freeze({
        bytes,
        width: dimensions.width,
        height: dimensions.height,
      });
    });

    const pdfBytes = buildPdfFromJpegPages(pages);

    return {
      ok: true,
      pdfBase64: base64FromBytes(pdfBytes),
      pageCount: pages.length,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: errorMessage(error, "Could not export slides to PDF."),
    };
  } finally {
    cleanupExportFrame(frameToken);
  }
}

function handleAsyncExport(
  exporter: () => Promise<unknown>,
  fallbackError: string,
  sendResponse: RuntimeMessageResponse,
): boolean {
  exporter()
    .then((result) => sendResponse(result))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: errorMessage(error, fallbackError),
      }),
    );

  return true;
}

function isValidPageMediaResponse(
  response: ExternalRecord | null,
): response is ExternalRecord & PageMediaResponse {
  return (
    response !== null &&
    typeof response.status === "number" &&
    Number.isInteger(response.status) &&
    response.status >= 0 &&
    response.status <= 599 &&
    typeof response.body === "string" &&
    response.body.length <= 24 * 1024 * 1024
  );
}

function handlePageMediaResult(
  message: ExternalRecord,
  sender: chrome.runtime.MessageSender,
  sendResponse: RuntimeMessageResponse,
): boolean {
  if (
    sender.tab?.id === undefined ||
    !isTrustedTrackSender(sender, chrome.runtime.id)
  ) {
    return false;
  }

  const requestId =
    typeof message.requestId === "string" ? message.requestId : "";

  const pending = pageMediaRequests.get(requestId);
  const response = externalRecord(message.response);

  if (
    !pending ||
    pending.tabId !== sender.tab.id ||
    !isValidPageMediaResponse(response)
  ) {
    sendResponse({ ok: false });

    return false;
  }

  clearTimeout(pending.timeout);
  pageMediaRequests.delete(requestId);
  pending.resolve({ status: response.status, body: response.body });
  sendResponse({ ok: true });

  return false;
}

const runtimeMessageHandlers: Readonly<Record<string, RuntimeMessageHandler>> =
  Object.freeze({
    "list-detections"(message, _sender, sendResponse) {
      const tabId = message.tabId;

      if (!validTabId(tabId)) {
        sendResponse({ error: "Invalid tab." });

        return false;
      }

      chrome.tabs
        .get(tabId)
        .then(async (tab) => {
          const pageUrl = tab.url || "";

          await enqueueDetection(() => synchronizePageState(tabId, pageUrl));

          const [state, stored, domDocumentsResponse] = await Promise.all([
            refreshStoredQualityOptions(tabId),
            chrome.storage.session.get(outlineKey(tabId)),
            chrome.tabs
              .sendMessage(
                tabId,
                { type: "extract-topic-documents" },
                { frameId: 0 },
              )
              .catch(() => null),
          ]);

          const pageTracks = await collectActiveTabSubtitles(
            tabId,
            pageUrl,
            tab.title || "",
            state.subtitles,
          );

          const domDocuments = validatedDocumentsRecord(
            externalRecord(domDocumentsResponse)?.documents,
          );

          const mergedDocuments = mergeTopicCompanionDocuments(
            state.documents,
            domDocuments,
          );

          return {
            ...state,
            subtitles: uniqueSubtitles([...state.subtitles, ...pageTracks]),
            ...(mergedDocuments ? { documents: mergedDocuments } : {}),
            trackOutline: stored[outlineKey(tabId)] || null,
          };
        })
        .then((payload) => sendResponse(payload))
        .catch(() =>
          sendResponse({ streams: [], subtitles: [], trackOutline: null }),
        );

      return true;
    },
    "page-location"(message, sender, sendResponse) {
      const tabId = sender.tab?.id;
      const url = message.url;

      if (
        tabId === undefined ||
        sender.id !== chrome.runtime.id ||
        sender.frameId !== 0 ||
        typeof url !== "string" ||
        url !== sender.url
      ) {
        return false;
      }

      enqueueDetection(() => synchronizePageState(tabId, url))
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "clear-detections"(message, _sender, sendResponse) {
      const tabId = message.tabId;

      if (!validTabId(tabId)) {
        sendResponse({ error: "Invalid tab." });

        return false;
      }

      chrome.tabs
        .get(tabId)
        .catch(() => null)
        .then((tab) =>
          setState(tabId, {
            pageUrl: tab?.url || "",
            streams: [],
            subtitles: [],
          }),
        )
        .then(() => sendResponse({ ok: true }));

      return true;
    },
    "open-download"(message, _sender, sendResponse) {
      const download = validatedDownloadRequest(message.download);

      if (!download) {
        sendResponse({ error: "Invalid media URL." });

        return false;
      }

      const documents = validatedDocumentsRecord(
        externalRecord(message.download)?.documents,
      );

      const storedDownload = documents
        ? Object.freeze({ ...download, documents })
        : download;

      const downloadRequestId = crypto.randomUUID();

      chrome.storage.session
        .set({ [`download-request:${downloadRequestId}`]: storedDownload })
        .then(async () => {
          await authorizeDownloadMedia(download);

          await chrome.tabs.create({
            url: chrome.runtime.getURL(
              `src/index.html?download-request=${downloadRequestId}`,
            ),
          });

          sendResponse({ ok: true });
        });

      return true;
    },
    "register-download-target"(message, _sender, sendResponse) {
      const url = message.url;
      const filename = message.filename;

      if (
        !isAllowedDownloadTargetUrl(url, extensionOrigin) ||
        !isSafeDownloadTarget(filename)
      ) {
        sendResponse({ error: "Invalid download target." });

        return false;
      }

      pendingDownloadTargets.set(url, filename);
      sendResponse({ ok: true });

      return false;
    },
    "release-download-target"(message, _sender, sendResponse) {
      const url = message.url;

      if (!isAllowedDownloadTargetUrl(url, extensionOrigin)) {
        sendResponse({ error: "Invalid download target." });

        return false;
      }

      pendingDownloadTargets.delete(url);
      sendResponse({ ok: true });

      return false;
    },
    "take-download-request"(message, _sender, sendResponse) {
      const key = `download-request:${String(message.downloadRequestId)}`;

      chrome.storage.session.get(key).then(async (stored) => {
        const download =
          (stored[key] as ValidatedDownloadRequest | undefined) || null;

        if (download) {
          await chrome.storage.session.set({
            [key]: { ...download, autoStart: false },
          });
        }

        sendResponse({ download });
      });

      return true;
    },
    "fetch-source-media"(message, _sender, sendResponse) {
      const sourceTabId = message.sourceTabId;
      const mediaUrl = safeMediaUrl(message.url);
      const responseType = message.responseType;

      if (
        !validTabId(sourceTabId) ||
        !mediaUrl ||
        (responseType !== "text" && responseType !== "bytes")
      ) {
        sendResponse({ error: "Invalid page media request.", handled: true });

        return false;
      }

      fetchFromTrackPage(sourceTabId, mediaUrl, responseType)
        .then((response) => sendResponse({ ...response, handled: true }))
        .catch((error: unknown) =>
          sendResponse({
            error: errorMessage(
              error,
              "Could not use the signed-in track tab.",
            ),
            handled: true,
          }),
        );

      return true;
    },
    "page-media-result": handlePageMediaResult,
    "page-subtitle-tracks"(message, sender, sendResponse) {
      if (sender.tab?.id === undefined) return false;

      recordPageSubtitles(sender.tab.id, message.tracks, sender.frameId ?? 0)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "hidden-probe-frame-ready"(message, sender, sendResponse) {
      const probeId = message.probeId;

      if (
        sender.id !== chrome.runtime.id ||
        sender.tab?.id === undefined ||
        typeof probeId !== "string"
      ) {
        return false;
      }

      const pending = pendingHiddenFrameReady.get(probeId);
      const senderOrigin = originOfUrl(sender.url || "");

      if (
        pending &&
        pending.tabId === sender.tab.id &&
        pending.origin &&
        senderOrigin === pending.origin &&
        typeof sender.frameId === "number" &&
        Number.isSafeInteger(sender.frameId) &&
        sender.frameId > 0
      ) {
        pending.resolve(sender.frameId);
        sendResponse({ ok: true });

        return false;
      }

      sendResponse({ ok: false });

      return false;
    },
    "diagram-frame-ready"(message, sender, sendResponse) {
      return handleExportFrameReady(
        message,
        sender,
        sendResponse,
        DIAGRAM_FRAME_PREFIX,
        isExcalidrawUrl,
      );
    },
    "slides-frame-ready"(message, sender, sendResponse) {
      return handleExportFrameReady(
        message,
        sender,
        sendResponse,
        SLIDES_FRAME_PREFIX,
        (rawUrl) => Boolean(safeMediaUrl(rawUrl)),
      );
    },
    "page-topic-documents"(message, sender, sendResponse) {
      const tabId = sender.tab?.id;

      if (
        !validTabId(tabId) ||
        !isTrustedTrackFrameSender(sender, chrome.runtime.id)
      ) {
        return false;
      }

      const documents = validatedDocumentsRecord(message.documents);

      if (!documents) {
        sendResponse({ ok: false });

        return false;
      }

      const pageUrl =
        safeMediaUrl(message.sourceUrl) ||
        (typeof sender.url === "string" ? sender.url : "");

      enqueueDetection(async () => {
        const state = await synchronizePageState(tabId, pageUrl);

        const mergedDocuments = mergeTopicCompanionDocuments(
          state.documents,
          documents,
        );

        await setState(tabId, {
          ...state,
          ...(mergedDocuments ? { documents: mergedDocuments } : {}),
        });
      })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "page-track-stream"(message, sender, sendResponse) {
      const tabId = sender.tab?.id;

      if (!validTabId(tabId)) return false;

      const isRegisteredProbeFrame =
        sender.id === chrome.runtime.id &&
        validTabId(sender.frameId) &&
        hiddenFrameProbes.has(hiddenFrameKey(tabId, sender.frameId));

      if (
        !isRegisteredProbeFrame &&
        !isTrustedTrackFrameSender(sender, chrome.runtime.id)
      ) {
        return false;
      }

      const stream = (externalRecord(message.stream) ||
        {}) as TrackStreamSignal;

      recordTrackStream(tabId, stream, sender.frameId ?? 0)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "track-topic-probed"(message, sender, sendResponse) {
      const active = resolveActiveHeadlessProbe(message, sender);
      const topicIndex = message.topicIndex;

      if (
        active &&
        typeof topicIndex === "number" &&
        Number.isInteger(topicIndex)
      ) {
        active.onTopic(
          topicIndex,
          (externalRecord(message.stream) as TrackStreamSignal | null) || null,
          message.partial === true,
        );

        sendResponse({ ok: true });

        return false;
      }

      sendResponse({ ok: false });

      return false;
    },
    "track-topics-probe-done"(message, sender, sendResponse) {
      const active = resolveActiveHeadlessProbe(message, sender);

      if (!active) {
        sendResponse({ ok: false });

        return false;
      }

      active.onDone(
        Array.isArray(message.unresolvedIndices)
          ? message.unresolvedIndices
          : [],
        externalRecord(message.unresolvedLinks) || {},
        message.rateLimited === true,
        externalRecord(message.unresolvedLinkLists) || {},
      );

      sendResponse({ ok: true });

      return false;
    },
    "track-outline"(message, sender, sendResponse) {
      const tabId = sender.tab?.id;

      if (
        tabId === undefined ||
        !isTrustedTrackSender(sender, chrome.runtime.id)
      ) {
        return false;
      }

      const outlineRecord = externalRecord(message.outline);
      const items = topicsFromOutline(outlineRecord, 500);
      const pageUrl = typeof sender.url === "string" ? sender.url : "";

      const outline = {
        title: boundedText(outlineRecord?.title, 240) || "Track",
        items,
        pageUrl,
      };

      const key = outlineKey(tabId);

      chrome.storage.session
        .get(key)
        .then((stored) => {
          const existing = externalRecord(stored[key]);

          const existingCount = Array.isArray(existing?.items)
            ? existing.items.length
            : 0;

          if (
            existing &&
            existing.pageUrl === pageUrl &&
            existingCount > items.length
          ) {
            return;
          }

          return chrome.storage.session.set({ [key]: outline });
        })
        .then(() => sendResponse({ ok: true }));

      return true;
    },
    "start-track-scan"(message, _sender, sendResponse) {
      const outlineRecord = externalRecord(message.outline);
      const items = topicsFromOutline(outlineRecord);

      if (!items.length) {
        sendResponse({
          error: "No topic links were found on this track page.",
        });

        return false;
      }

      const rawTitle = outlineRecord?.title;

      const sourceTabId = validTabId(message.sourceTabId)
        ? message.sourceTabId
        : null;

      const scan: TrackScan = {
        id: crypto.randomUUID(),
        title: typeof rawTitle === "string" && rawTitle ? rawTitle : "Track",
        items,
        discovered: [],
        nextTopicIndex: 0,
        currentTopicIndex: null,
        status: "scanning",
        sourceTabId,
        startedAt: Date.now(),
      };

      setTrackScan(scan)
        .then(async () => {
          await chrome.tabs.create({
            url: chrome.runtime.getURL(`src/track.html?scan=${scan.id}`),
          });

          runHeadlessTrackScan(scan.id, sourceTabId).catch(() => {});
          sendResponse({ scanId: scan.id });
        })
        .catch((error: unknown) =>
          sendResponse({ error: errorMessage(error) }),
        );

      return true;
    },
    "get-track-scan"(message, _sender, sendResponse) {
      getTrackScan(String(message.scanId)).then((scan) =>
        sendResponse({ scan }),
      );

      return true;
    },
    "authorize-download-media"(message, _sender, sendResponse) {
      const url = safeMediaUrl(message.url);
      const sourceUrl = safeMediaUrl(message.sourceUrl) || "";

      if (!url) {
        sendResponse({ ok: false });

        return false;
      }

      authorizeDownloadMedia({ url, sourceUrl })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "set-download-tab-keepalive"(message, sender, sendResponse) {
      const tabId = sender.tab?.id;

      if (!validTabId(tabId)) {
        sendResponse({ ok: false });

        return false;
      }

      chrome.tabs
        .update(tabId, { autoDiscardable: message.keepAlive !== true })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "open-track-download"(message, _sender, sendResponse) {
      return handleOpenTrackDownload(message, sendResponse);
    },
    "export-diagram-svg"(message, sender, sendResponse) {
      const rawUrl = typeof message.url === "string" ? message.url : "";

      const frameToken =
        typeof message.frameToken === "string" ? message.frameToken : "";

      return handleAsyncExport(
        () => exportExcalidrawSvg(rawUrl, sender.tab?.id, frameToken),
        "Could not export diagram SVG.",
        sendResponse,
      );
    },
    "export-slides-pdf"(message, sender, sendResponse) {
      const rawUrl = typeof message.url === "string" ? message.url : "";

      const frameToken =
        typeof message.frameToken === "string" ? message.frameToken : "";

      return handleAsyncExport(
        () => exportSlidesToPdf(rawUrl, sender.tab?.id, frameToken),
        "Could not export slides PDF.",
        sendResponse,
      );
    },
    "take-track-download"(message, _sender, sendResponse) {
      const key = `track-download:${String(message.trackDownloadId)}`;

      chrome.storage.session.get(key).then((stored) => {
        sendResponse({ trackDownload: stored[key] || null });
      });

      return true;
    },
    "complete-track-download-topic"(message, _sender, sendResponse) {
      const key = `track-download:${String(message.trackDownloadId)}`;
      const topicIndex = message.topicIndex;

      if (typeof topicIndex !== "number" || !Number.isInteger(topicIndex)) {
        sendResponse({ ok: false });

        return false;
      }

      chrome.storage.session
        .get(key)
        .then(async (stored) => {
          const current = externalRecord(stored[key]);

          if (!current) return;

          const existing = Array.isArray(current.completedTopicIndices)
            ? current.completedTopicIndices.filter(
                (idx): idx is number =>
                  typeof idx === "number" && Number.isInteger(idx),
              )
            : [];

          if (existing.includes(topicIndex)) return;

          await chrome.storage.session.set({
            [key]: {
              ...current,
              completedTopicIndices: [...existing, topicIndex],
            },
          });
        })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "update-track-download-preferences"(message, _sender, sendResponse) {
      const trackDownloadId =
        typeof message.trackDownloadId === "string"
          ? message.trackDownloadId
          : "";

      if (!trackDownloadId) {
        sendResponse({ ok: false });

        return false;
      }

      const key = `track-download:${trackDownloadId}`;

      chrome.storage.session
        .get(key)
        .then(async (stored) => {
          const current = externalRecord(stored[key]);

          if (!current) return;

          await chrome.storage.session.set({
            [key]: mergeTrackDownloadPreferences(current, message),
          });
        })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
  });

function updatedTrackQualityPreference(
  rawValue: unknown,
  fallback: unknown,
): string | undefined {
  const existing = typeof fallback === "string" ? fallback : undefined;

  if (typeof rawValue !== "string") return existing;
  const trimmed = rawValue.trim();

  if (
    trimmed === "best" ||
    trimmed === "smallest" ||
    /^\d{3,4}$/.test(trimmed)
  ) {
    return trimmed;
  }

  return existing;
}

function mergeTrackDownloadPreferences(
  current: ExternalRecord,
  message: ExternalRecord,
): ExternalRecord {
  const outputFormat =
    typeof message.outputFormat === "string"
      ? outputFormatOrDefault(message.outputFormat)
      : current.outputFormat;

  const numericConcurrency = Number(message.segmentConcurrency);

  const segmentConcurrency = Number.isFinite(numericConcurrency)
    ? clampConcurrency(numericConcurrency)
    : current.segmentConcurrency;

  const trackQualityPreference = updatedTrackQualityPreference(
    message.trackQualityPreference,
    current.trackQualityPreference,
  );

  const preferredQualityLabel =
    typeof message.preferredQualityLabel === "string"
      ? boundedText(message.preferredQualityLabel, 100)
      : current.preferredQualityLabel;

  return {
    ...current,
    outputFormat,
    segmentConcurrency,
    ...(trackQualityPreference ? { trackQualityPreference } : {}),
    ...(typeof preferredQualityLabel === "string"
      ? { preferredQualityLabel }
      : {}),
  };
}

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, sender, sendResponse) => {
    const message = externalRecord(rawMessage);

    if (!message || typeof message.type !== "string") return;

    if (
      extensionOnlyMessages.has(message.type) &&
      !isTrustedExtensionSender(sender, chrome.runtime.id, extensionOrigin)
    ) {
      sendResponse({ error: "Untrusted extension message." });

      return;
    }

    const handler = Object.prototype.hasOwnProperty.call(
      runtimeMessageHandlers,
      message.type,
    )
      ? runtimeMessageHandlers[message.type]
      : undefined;

    return handler ? handler(message, sender, sendResponse) : undefined;
  },
);
