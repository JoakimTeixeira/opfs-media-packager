import { waitForBrowserDownload } from "./browser-download.ts";
import {
  errorMessageOf,
  isAbortError,
  userError,
  formatBytes,
} from "./download-display.ts";
import {
  parsePlaylist,
  type MediaSegment,
  type MasterPlaylistAnalysis,
  type MediaPlaylistAnalysis,
} from "./hls-parser.ts";
import { downloadControlState } from "../lib/downloads/download-control-state.ts";
import {
  shouldHaltTrackQueue,
  type TrackQueueState,
} from "../lib/track/track-queue-policy.ts";
import {
  DEFAULT_DOWNLOAD_PREFERENCES,
  DEFAULT_OUTPUT_FORMAT,
  OUTPUT_FORMAT_OPTIONS,
  SEGMENT_CONCURRENCY_OPTIONS,
  trackDownloadModeOrDefault,
  trackQualityPreferenceFromLabel,
  outputFormatOrDefault,
  renderPreferenceOptions,
  type TrackDownloadMode,
  type OutputFormat,
} from "../lib/downloads/download-preferences.ts";
import {
  COMMON_IMAGE_EXTENSIONS,
  buildExistingDownloadIndex,
  findExistingFilenameByExtensions,
  hasExistingDownload,
  normalizeDownloadPath,
} from "../lib/downloads/existing-downloads.ts";
import {
  DEFAULT_DOWNLOAD_SUBFOLDER,
  downloadRelativePath,
  downloadSubfolderOrDefault,
} from "../lib/downloads/download-subfolder.ts";
import {
  mediaFilename,
  sanitizeFilenameStem,
  subtitleFilename,
  videoFilename,
} from "../lib/shared/filename.ts";
import { type VideoQualityOption } from "../lib/media/hls-master.ts";
import { icon, type IconName } from "../lib/shared/icons.ts";
import {
  OPFS_JOB_PREFIX,
  OPFS_RESUME_PREFIX,
  buildConcatManifest,
  canonicalResumeStreamKey,
  checkpointPartSize,
  classifyRemuxErrorKind,
  expiredResumeJobNames,
  nextAdaptiveConcurrency,
  parseFfmpegProgressLine,
  segmentRetryDelayMs,
  shouldSplitDiscontinuityPart,
  staleOpfsJobNames,
  validateResumeCheckpoint,
  type OpfsCheckpointPart,
  type OpfsResumeCheckpoint,
  type RemuxErrorKind,
} from "../lib/downloads/large-file-remux.ts";
import {
  canonicalDocumentUrlKey,
  countTopicCompanionDocuments,
  prefixedDocumentFilename,
  type TopicFileAsset,
  type TopicLinkAsset,
  type TopicMarkdownNote,
  type TopicCompanionDocuments,
} from "../lib/materials/topic-assets.ts";
import {
  annotateMarkdownWithDownloadedArtifacts,
  cleanTopicMarkdown,
  type DownloadedArtifactAnnotation,
} from "../lib/materials/topic-markdown.ts";
import { fetchDirectMedia as fetchDirectMediaRequest } from "../lib/media/media-request.ts";
import { safeMediaUrl } from "../lib/security/security.ts";
import {
  DEFAULT_SEGMENT_CONCURRENCY,
  clampConcurrency,
  orderedSegmentGroups,
} from "../lib/downloads/segments.ts";
import {
  decodeSubtitleBytes,
  repairDoubleEncodedUtf8,
} from "../lib/subtitles/subtitle-encoding.ts";
import { isDirectVideoUrl } from "../lib/media/stream-identity.ts";
import type { KnownSubtitleTrack } from "../lib/subtitles/subtitle-tracks.ts";
import { FFmpeg } from "../vendor/ffmpeg/classes.js";

interface ActiveDownloadJob {
  readonly state:
    "running" | "completed" | "cancelled" | "failed" | "interrupted";
  readonly filename: string;
  readonly completedSegments: number;
  readonly totalSegments: number;
  readonly startedAt: number;
  readonly updatedAt?: number;
  readonly error?: string;
}

interface SourcePageFetchResponse {
  readonly handled: boolean;
  readonly status: number;
  readonly body: string;
  readonly error?: string;
}

interface TrackExtraVideoDownload {
  readonly url: string;
  readonly title: string;
  readonly sourceUrl?: string;
  readonly kind?: "master" | "media" | "direct";
  readonly qualityOptions?: readonly VideoQualityOption[];
  readonly subtitles?: readonly KnownSubtitleTrack[];
}

interface SavedTopicVideoArtifact {
  readonly sourceUrl: string;
  readonly filename: string;
}

interface TrackTopicDownload {
  readonly topicIndex?: number;
  readonly url?: string;
  readonly title?: string;
  readonly primaryVideoTitle?: string;
  readonly extraVideos?: readonly TrackExtraVideoDownload[];
  readonly sourceUrl?: string;
  readonly kind?: "master" | "media" | "direct";
  readonly folderPath?: readonly string[];
  readonly qualityOptions?: readonly VideoQualityOption[];
  readonly subtitles?: readonly KnownSubtitleTrack[];
  readonly documents?: TopicCompanionDocuments;
}

interface TrackDownloadPlan {
  readonly title?: string;
  readonly sourceTabId?: number | null;
  readonly items?: readonly TrackTopicDownload[];
  readonly completedTopicIndices?: readonly number[];
  readonly outputFormat?: OutputFormat;
  readonly trackQualityPreference?: string;
  readonly preferredQualityLabel?: string;
  readonly subtitleDownloadPreference?: string;
  readonly trackDownloadMode?: TrackDownloadMode;
  readonly segmentConcurrency?: number;
}

interface HandoffDownloadRequest {
  readonly url: string;
  readonly selectedQualityUrl?: string;
  readonly title?: string;
  readonly sourceUrl?: string;
  readonly sourceTabId?: number | null;
  readonly qualityOptions?: readonly VideoQualityOption[];
  readonly outputFormat?: string;
  readonly autoStart?: boolean;
  readonly subtitle?: KnownSubtitleTrack | null;
  readonly documents?: TopicCompanionDocuments | null;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) throw new Error(`Missing required element: ${selector}`);

  return element;
}

const playlistUrl = requireElement<HTMLInputElement>("#playlist-url");
const qualitySelect = requireElement<HTMLSelectElement>("#quality");
const filename = requireElement<HTMLInputElement>("#filename");
const container = requireElement<HTMLSelectElement>("#container");
const concurrency = requireElement<HTMLSelectElement>("#concurrency");
const analyzeButton = requireElement<HTMLButtonElement>("#analyze");
const downloadButton = requireElement<HTMLButtonElement>("#download");
const downloadLabel = requireElement<HTMLElement>("#download-label");
const cancelButton = requireElement<HTMLButtonElement>("#cancel");
const message = requireElement<HTMLElement>("#message");
const details = requireElement<HTMLElement>("#details");
const progress = requireElement<HTMLProgressElement>("#progress");
const subtitleNote = requireElement<HTMLElement>("#subtitle-note");

const trackDownloadNote = requireElement<HTMLElement>("#track-download-note");

const sourceHost = requireElement<HTMLElement>("#source-host");
const videoTitle = requireElement<HTMLElement>("#video-title");
const formatNote = requireElement<HTMLElement>("#format-note");

const downloadSubfolderStatus = requireElement<HTMLElement>(
  "#download-subfolder-status",
);

const downloadSubfolderInput = requireElement<HTMLInputElement>(
  "#download-subfolder",
);

const saveDownloadSubfolderButton = requireElement<HTMLButtonElement>(
  "#save-download-subfolder",
);

const copyPlaylistButton = requireElement<HTMLButtonElement>("#copy-playlist");

function renderLucideIcons(): void {
  for (const placeholder of document.querySelectorAll("[data-icon]")) {
    const name = placeholder.getAttribute("data-icon") as IconName | null;

    if (!name) continue;
    placeholder.replaceWith(icon(name, [...placeholder.classList]));
  }
}

renderLucideIcons();
renderPreferenceOptions(container, OUTPUT_FORMAT_OPTIONS);
renderPreferenceOptions(concurrency, SEGMENT_CONCURRENCY_OPTIONS);

requireElement<HTMLElement>("#build-version").textContent =
  `v${chrome.runtime.getManifest().version}`;

const appState: {
  playlistAnalysis: MasterPlaylistAnalysis | null;
  controller: AbortController | null;
  selectedQualityPlaylistUrl: string | null;
  selectedSubtitleTrack: KnownSubtitleTrack | null;
  sourcePageUrl: string;
  sourceTabId: number | null;
  autoStart: boolean;
  activeDownloadJob: ActiveDownloadJob | null;
  activeTrackDownload: TrackDownloadPlan | null;
  trackCompletedIndices: Set<number>;
  trackDownloadedDocumentsByKey: Map<string, DownloadedDocumentRecord>;
  trackExistingDownloads: Set<string> | null;
  trackRunActive: boolean;
  userSelectedQualityForUrl: string;
  trackDownloadCancelled: boolean;
  trackFolderSegments: readonly string[];
  downloadSubfolder: string;
  keepAliveDepth: number;
  activeOpfsJobDir: string | null;
  singleDownloadDocuments: TopicCompanionDocuments | null;
} = {
  playlistAnalysis: null,
  controller: null,
  selectedQualityPlaylistUrl: null,
  selectedSubtitleTrack: null,
  sourcePageUrl: "",
  sourceTabId: null,
  autoStart: false,
  activeDownloadJob: null,
  activeTrackDownload: null,
  trackCompletedIndices: new Set<number>(),
  trackDownloadedDocumentsByKey: new Map<string, DownloadedDocumentRecord>(),
  trackExistingDownloads: null,
  trackRunActive: false,
  userSelectedQualityForUrl: "",
  trackDownloadCancelled: false,
  trackFolderSegments: [],
  downloadSubfolder: DEFAULT_DOWNLOAD_SUBFOLDER,
  keepAliveDepth: 0,
  activeOpfsJobDir: null,
  singleDownloadDocuments: null,
};

const runStateKey = "lastDownloadRun";

function hasResumableTrackPlan(): boolean {
  return Boolean(
    appState.activeTrackDownload?.items?.some(
      (item) => !isTopicAlreadyCompleted(item, appState.trackCompletedIndices),
    ),
  );
}

function updateDownloadButtonLabel(): void {
  downloadLabel.textContent =
    hasResumableTrackPlan() && !appState.trackRunActive
      ? "Resume track"
      : "Download";
}

function syncTrackPreferencesFromControls(): void {
  const active = appState.activeTrackDownload;

  if (!active) return;

  const outputFormat = outputFormatOrDefault(container.value);
  const segmentConcurrency = clampConcurrency(Number(concurrency.value));

  const selectedQuality =
    appState.playlistAnalysis?.qualityOptions[Number(qualitySelect.value)];

  const preferredQualityLabel =
    selectedQuality?.label || active.preferredQualityLabel;

  const extractedQuality = selectedQuality?.label
    ? trackQualityPreferenceFromLabel(selectedQuality.label)
    : "";

  const trackQualityPreference =
    extractedQuality || active.trackQualityPreference;

  appState.activeTrackDownload = {
    ...active,
    outputFormat,
    segmentConcurrency,
    ...(trackQualityPreference ? { trackQualityPreference } : {}),
    ...(preferredQualityLabel ? { preferredQualityLabel } : {}),
  };

  if (!trackDownloadId) return;

  chrome.runtime
    .sendMessage({
      type: "update-track-download-preferences",
      trackDownloadId,
      outputFormat,
      segmentConcurrency,
      ...(trackQualityPreference ? { trackQualityPreference } : {}),
      ...(preferredQualityLabel ? { preferredQualityLabel } : {}),
    })
    .catch(() => {});
}

async function loadExistingDownloadsIndex(): Promise<Set<string>> {
  try {
    const initial = await chrome.downloads.search({
      state: "complete",
      exists: true,
    });

    if (!initial.length) return new Set<string>();

    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    const refreshed = await chrome.downloads.search({
      state: "complete",
      exists: true,
    });

    return buildExistingDownloadIndex(refreshed);
  } catch {
    return new Set<string>();
  }
}

function isAlreadyDownloadedFile(outputName: string): boolean {
  if (!appState.trackExistingDownloads?.size) return false;

  const relativeTarget = downloadRelativePath(
    currentDownloadSubfolder(),
    outputName,
  );

  return hasExistingDownload(appState.trackExistingDownloads, relativeTarget);
}

function recordDownloadedRelativePath(relativePath: string): void {
  if (!appState.trackExistingDownloads) return;
  appState.trackExistingDownloads.add(normalizeDownloadPath(relativePath));
}

function setStatus(nextMessage: string, nextDetails = ""): void {
  message.textContent = nextMessage;
  details.textContent = nextDetails;
}

function persistRun(update: Partial<ActiveDownloadJob>): void {
  if (!appState.activeDownloadJob) return;

  appState.activeDownloadJob = Object.freeze({
    ...appState.activeDownloadJob,
    ...update,
    updatedAt: Date.now(),
  });

  chrome.storage.session
    .set({ [runStateKey]: appState.activeDownloadJob })
    .catch(() => {});
}

/**
 * Keeps selection controls editable while metadata is refreshed, then locks
 * every output-affecting value only for a running download job.
 */
function setBusy(busy: boolean, downloadActive = false): void {
  const state = downloadControlState({
    busy,
    hasPlaylist: Boolean(appState.playlistAnalysis),
    downloadActive,
    canResumeTrack: hasResumableTrackPlan(),
  });

  analyzeButton.disabled = state.analyzeDisabled;
  downloadButton.disabled = state.downloadDisabled;
  qualitySelect.disabled = state.qualityDisabled;
  filename.disabled = state.filenameDisabled;
  concurrency.disabled = state.concurrencyDisabled;
  container.disabled = state.outputDisabled;
  downloadSubfolderInput.disabled = state.subfolderDisabled;
  saveDownloadSubfolderButton.disabled = state.saveSubfolderDisabled;
  cancelButton.hidden = state.cancelHidden;
  updateDownloadButtonLabel();
}

function updateOutputNote(): void {
  formatNote.textContent =
    container.value === "mkv"
      ? "MKV file with the selected subtitle inside"
      : "MP4 file with a matching separate subtitle file";
}

function currentDownloadSubfolder(): string {
  return downloadSubfolderOrDefault(
    [appState.downloadSubfolder, ...appState.trackFolderSegments]
      .filter(Boolean)
      .join("/"),
  );
}

function showDownloadSubfolder(): void {
  downloadSubfolderInput.value = appState.downloadSubfolder;
  downloadSubfolderStatus.textContent = `Downloads / ${appState.downloadSubfolder}`;
}

async function restoreDownloadSubfolder(): Promise<void> {
  const stored = await chrome.storage.local.get({
    downloadSubfolder: DEFAULT_DOWNLOAD_SUBFOLDER,
  });

  appState.downloadSubfolder = downloadSubfolderOrDefault(
    stored.downloadSubfolder,
  );

  showDownloadSubfolder();
}

async function saveDownloadSubfolder(): Promise<void> {
  appState.downloadSubfolder = downloadSubfolderOrDefault(
    downloadSubfolderInput.value,
  );

  await chrome.storage.local.set({
    downloadSubfolder: appState.downloadSubfolder,
  });

  showDownloadSubfolder();

  setStatus(
    "Download subfolder saved",
    `Future files will go to Downloads / ${appState.downloadSubfolder}.`,
  );
}

function setFailure(title: string, error: unknown): void {
  setStatus(title, userError(error));
}

async function copyPlaylistUrl(): Promise<void> {
  const value = playlistUrl.value.trim();

  if (!value) return;
  await navigator.clipboard.writeText(value);

  setStatus(
    "Manifest link copied",
    "You can paste the HLS manifest link wherever you need it.",
  );
}

updateOutputNote();

const downloadSubfolderReady = restoreDownloadSubfolder().catch((error) =>
  setFailure("Could not load download subfolder", error),
);

sweepStaleOpfsJobs(appState.activeOpfsJobDir).catch(() => {});

function isApiTrackSource(value: string): boolean {
  try {
    return /\/courses\//i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function fetchDirectMedia(
  safeUrl: string,
  signal: AbortSignal,
  headers?: HeadersInit,
): Promise<Response> {
  return fetchDirectMediaRequest({
    mediaUrl: safeUrl,
    sourcePageUrl: appState.sourcePageUrl,
    signal,
    headers,
  });
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const safeUrl = safeMediaUrl(url);

  if (!safeUrl) throw new Error("Unsafe manifest URL.");
  const sourceResponse = await fetchFromSourcePage(safeUrl, "text");

  if (sourceResponse) {
    if (sourceResponse.status >= 200 && sourceResponse.status < 300) {
      return sourceResponse.body;
    }

    throw new Error(`Playlist request failed: HTTP ${sourceResponse.status}.`);
  }

  const response = await fetchDirectMedia(safeUrl, signal);

  if (!response.ok) {
    throw new Error(`Playlist request failed: HTTP ${response.status}.`);
  }

  return response.text();
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isSameOriginUrl(targetUrl: string, sourceUrl: string): boolean {
  try {
    return (
      Boolean(sourceUrl) &&
      new URL(targetUrl).origin === new URL(sourceUrl).origin
    );
  } catch {
    return false;
  }
}

async function fetchFromSourcePage(
  url: string,
  responseType: "text" | "bytes",
  allowSameOrigin = false,
): Promise<SourcePageFetchResponse | null> {
  if (!Number.isSafeInteger(appState.sourceTabId)) return null;

  const canUseSourceTab =
    isApiTrackSource(appState.sourcePageUrl) ||
    (allowSameOrigin && isSameOriginUrl(url, appState.sourcePageUrl));

  if (!canUseSourceTab) return null;

  const response = (await chrome.runtime.sendMessage({
    type: "fetch-source-media",
    sourceTabId: appState.sourceTabId,
    url,
    responseType,
  })) as SourcePageFetchResponse | undefined;

  if (!response?.handled) return null;
  if (response.error) throw new Error(response.error);

  return response;
}

async function inspect(
  url: string,
  signal: AbortSignal,
): Promise<MasterPlaylistAnalysis> {
  const playlist = parsePlaylist(await fetchText(url, signal), url);

  if (playlist.type === "master") return playlist;
  const pathSegment = new URL(url).pathname.split("/").at(-2) || "";
  const qualityHeight = /^(\d{3,4})p$/i.exec(pathSegment);

  if (!qualityHeight) {
    throw new Error(
      "No selectable video qualities were found. Use the stream's master manifest.",
    );
  }

  return {
    type: "master",
    qualityOptions: [
      { uri: url, label: `${qualityHeight[1]}p`, bandwidth: 0, codecs: "" },
    ],
  };
}

async function createFfmpeg(signal: AbortSignal): Promise<FFmpeg> {
  const ffmpeg = new FFmpeg();

  const timeoutHolder: { id: ReturnType<typeof setTimeout> | undefined } = {
    id: undefined,
  };

  try {
    await Promise.race([
      ffmpeg.load({
        classWorkerURL: chrome.runtime.getURL("vendor/ffmpeg/worker.js"),
        coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
        wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm"),
      }),
      new Promise<never>((_, reject) => {
        timeoutHolder.id = setTimeout(() => {
          ffmpeg.terminate();
          reject(new Error("The MP4 engine took too long to start."));
        }, 45000);
      }),
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            ffmpeg.terminate();
            reject(new DOMException("Download cancelled", "AbortError"));
          },
          { once: true },
        );
      }),
    ]);

    return ffmpeg;
  } catch (error) {
    ffmpeg.terminate();
    throw error;
  } finally {
    clearTimeout(timeoutHolder.id);
  }
}

async function analyze(): Promise<void> {
  const url = playlistUrl.value.trim();

  if (!url) throw new Error("Paste an M3U8 URL first.");

  if (!safeMediaUrl(url)) {
    throw new Error(
      "Use a remote HTTP(S) manifest URL; local network, credential-bearing, and malformed URLs are blocked.",
    );
  }

  const controller = new AbortController();

  appState.controller = controller;
  setBusy(true);
  progress.value = 0;
  progress.max = 1;
  setStatus("Reading playlist…");

  try {
    applyQualityChoices(await inspect(url, controller.signal));
  } finally {
    appState.controller = null;
    setBusy(false);
  }
}

function applyQualityChoices(analysis: MasterPlaylistAnalysis): void {
  appState.playlistAnalysis = analysis;
  qualitySelect.replaceChildren();

  appState.playlistAnalysis.qualityOptions.forEach((qualityOption, index) => {
    const option = document.createElement("option");

    option.value = String(index);
    option.textContent = qualityOption.label;
    qualitySelect.append(option);
  });

  const selectedIndex = appState.playlistAnalysis.qualityOptions.findIndex(
    (qualityOption) =>
      qualityOption.uri === appState.selectedQualityPlaylistUrl,
  );

  qualitySelect.value = String(selectedIndex < 0 ? 0 : selectedIndex);
  qualitySelect.disabled = false;

  setStatus(
    "Ready to download",
    `${appState.playlistAnalysis.qualityOptions.length} quality option${appState.playlistAnalysis.qualityOptions.length === 1 ? "" : "s"} available.`,
  );
}

function suppliedQualityChoices(
  qualityOptions: readonly VideoQualityOption[],
): MasterPlaylistAnalysis {
  return {
    type: "master",
    qualityOptions: qualityOptions.map(({ url, label, audioUri }) => ({
      uri: url,
      label,
      bandwidth: 0,
      codecs: "",
      ...(audioUri ? { audioUri } : {}),
    })),
  };
}

type SegmentFetchOutcome =
  | { readonly bytes: Uint8Array; readonly fatal: false }
  | {
      readonly bytes?: undefined;
      readonly error: Error;
      readonly fatal: boolean;
      readonly status?: number;
      readonly retryAfter?: string | null;
    };

function withAttemptTimeout(
  parentSignal: AbortSignal,
  timeoutMs: number,
): {
  readonly signal: AbortSignal;
  readonly isTimedOut: () => boolean;
  readonly cleanup: () => void;
} {
  const timeoutController = new AbortController();
  const state = { timedOut: false };

  const onParentAbort = (): void => {
    timeoutController.abort();
  };

  if (parentSignal.aborted) {
    timeoutController.abort();
  }

  if (!parentSignal.aborted) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    state.timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  return {
    signal: timeoutController.signal,
    isTimedOut: () => state.timedOut && !parentSignal.aborted,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

async function attemptSegmentFetch(
  safeUrl: string,
  headers: HeadersInit | undefined,
  signal: AbortSignal,
): Promise<SegmentFetchOutcome> {
  const sourceResponse = await fetchFromSourcePage(safeUrl, "bytes");

  if (sourceResponse) {
    if (sourceResponse.status >= 200 && sourceResponse.status < 300) {
      return { bytes: bytesFromBase64(sourceResponse.body), fatal: false };
    }

    return {
      error: new Error(`HTTP ${sourceResponse.status}`),
      fatal: [401, 403, 404, 429, 503].includes(sourceResponse.status),
      status: sourceResponse.status,
    };
  }

  const attemptTimeout = withAttemptTimeout(signal, 25000);

  try {
    const response = await fetchDirectMedia(
      safeUrl,
      attemptTimeout.signal,
      headers,
    );

    if (response.ok) {
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        fatal: false,
      };
    }

    // Authorization and rate-limit failures will not improve by repeating the same request rapidly.
    return {
      error: new Error(`HTTP ${response.status}`),
      fatal: [401, 403, 404, 429, 503].includes(response.status),
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
    };
  } catch (error) {
    if (attemptTimeout.isTimedOut()) {
      return {
        error: new Error("Segment request timed out."),
        fatal: false,
      };
    }

    throw error;
  } finally {
    attemptTimeout.cleanup();
  }
}

function waitWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface SegmentRetryState {
  transientAttempts: number;
  rateLimitRetries: number;
  totalAttempts: number;
  lastError: unknown;
}

function nextRetryDelayForOutcome(
  outcome: Exclude<SegmentFetchOutcome, { readonly bytes: Uint8Array }>,
  retryState: SegmentRetryState,
  onBackoff?: (status: number) => void,
): number | null {
  retryState.lastError = outcome.error;

  const isRateLimited = outcome.status === 429 || outcome.status === 503;

  if (outcome.fatal && isRateLimited && retryState.rateLimitRetries < 2) {
    retryState.rateLimitRetries += 1;
    onBackoff?.(outcome.status);

    return segmentRetryDelayMs(
      retryState.rateLimitRetries,
      outcome.status,
      outcome.retryAfter,
    );
  }

  if (outcome.fatal) return null;

  retryState.transientAttempts += 1;
  if (retryState.transientAttempts >= 6) return null;

  return segmentRetryDelayMs(retryState.transientAttempts);
}

async function fetchSegment(
  segment: MediaSegment,
  signal: AbortSignal,
  onBackoff?: (status: number) => void,
): Promise<Uint8Array> {
  const safeUrl = safeMediaUrl(segment.uri);

  if (!safeUrl) throw new Error("Unsafe segment URL.");
  const headers = segment.range ? { Range: segment.range.header } : undefined;

  const retryState: SegmentRetryState = {
    transientAttempts: 0,
    rateLimitRetries: 0,
    totalAttempts: 0,
    lastError: undefined,
  };

  while (retryState.totalAttempts < 8) {
    throwIfAborted(signal);
    retryState.totalAttempts += 1;

    try {
      const outcome = await attemptSegmentFetch(safeUrl, headers, signal);

      if (outcome.bytes) return outcome.bytes;

      const delayMs = nextRetryDelayForOutcome(outcome, retryState, onBackoff);

      if (delayMs === null) break;
      await waitWithAbort(delayMs, signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      retryState.lastError = error;
      retryState.transientAttempts += 1;
      if (retryState.transientAttempts >= 6) break;

      await waitWithAbort(
        segmentRetryDelayMs(retryState.transientAttempts),
        signal,
      );
    }
  }

  throw new Error(
    `Segment ${segment.sequence ?? "init"} failed after ${retryState.totalAttempts} attempts: ${errorMessageOf(retryState.lastError) || "network error"}.`,
  );
}

async function fetchSegmentGroup(
  segments: readonly MediaSegment[],
  signal: AbortSignal,
  onBackoff?: (status: number) => void,
): Promise<Uint8Array[]> {
  return Promise.all(
    segments.map((segment) => fetchSegment(segment, signal, onBackoff)),
  );
}

async function retryUnauthorizedSameOriginSubtitle(
  safeUrl: string,
  status: number,
  label: string,
): Promise<string> {
  if (
    (status !== 401 && status !== 403) ||
    !Number.isSafeInteger(appState.sourceTabId) ||
    !isSameOriginUrl(safeUrl, appState.sourcePageUrl)
  ) {
    throw new Error(`${label} failed: HTTP ${status}.`);
  }

  const pageRetry = await fetchFromSourcePage(safeUrl, "bytes", true).catch(
    () => null,
  );

  if (pageRetry && pageRetry.status >= 200 && pageRetry.status < 300) {
    return decodeSubtitleBytes(bytesFromBase64(pageRetry.body));
  }

  const retryStatus =
    pageRetry && pageRetry.status > 0 ? pageRetry.status : status;

  throw new Error(`${label} failed: HTTP ${retryStatus}.`);
}

async function fetchDecodedSubtitleText(
  safeUrl: string,
  signal: AbortSignal,
  label: string,
): Promise<string> {
  const sourceResponse = await fetchFromSourcePage(safeUrl, "bytes");

  if (sourceResponse) {
    if (sourceResponse.status < 200 || sourceResponse.status >= 300) {
      throw new Error(`${label} failed: HTTP ${sourceResponse.status}.`);
    }

    return decodeSubtitleBytes(bytesFromBase64(sourceResponse.body));
  }

  const response = await fetchDirectMedia(safeUrl, signal);

  if (!response.ok) {
    return retryUnauthorizedSameOriginSubtitle(safeUrl, response.status, label);
  }

  return decodeSubtitleBytes(new Uint8Array(await response.arrayBuffer()));
}

async function subtitleText(
  track: KnownSubtitleTrack,
  signal: AbortSignal,
): Promise<string> {
  const safeTrackUrl = safeMediaUrl(track.url);

  if (!safeTrackUrl) throw new Error("Unsafe subtitle URL.");

  const first = await fetchDecodedSubtitleText(
    safeTrackUrl,
    signal,
    "Subtitle request",
  );

  if (!first.trimStart().startsWith("#EXTM3U")) {
    return repairDoubleEncodedUtf8(first);
  }

  const playlist = parsePlaylist(first, safeTrackUrl);

  if (playlist.type !== "media") {
    throw new Error("Nested subtitle playlists are not supported.");
  }

  const parts = await Promise.all(
    playlist.segments.map(async (segment) => {
      const safeSegmentUrl = safeMediaUrl(segment.uri);

      if (!safeSegmentUrl) throw new Error("Unsafe subtitle segment URL.");

      return fetchDecodedSubtitleText(
        safeSegmentUrl,
        signal,
        "Subtitle segment",
      );
    }),
  );

  const joined = parts
    .map((part, index) =>
      index ? part.replace(/^WEBVTT[^\n]*\r?\n?/i, "") : part,
    )
    .join("\n");

  return repairDoubleEncodedUtf8(joined);
}

async function runRegisteredBrowserDownload(
  downloadUrl: string,
  targetFilename: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const registration = (await chrome.runtime.sendMessage({
      type: "register-download-target",
      url: downloadUrl,
      filename: targetFilename,
    })) as { ok?: boolean } | undefined;

    if (!registration?.ok) {
      throw new Error("Chrome could not prepare the requested download name.");
    }

    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename: targetFilename,
      saveAs: false,
      conflictAction: "uniquify",
    });

    await waitForBrowserDownload(downloadId, signal);
  } finally {
    chrome.runtime
      .sendMessage({ type: "release-download-target", url: downloadUrl })
      .catch(() => {});
  }
}

async function saveBrowserDownload(
  contents: Blob | Uint8Array | string,
  outputName: string,
  type: string,
  signal?: AbortSignal,
): Promise<void> {
  const targetFilename = downloadRelativePath(
    currentDownloadSubfolder(),
    outputName,
  );

  const blob =
    contents instanceof Blob
      ? contents
      : new Blob([contents as BlobPart], { type });

  const objectUrl = URL.createObjectURL(blob);

  try {
    await runRegisteredBrowserDownload(objectUrl, targetFilename, signal);
    recordDownloadedRelativePath(targetFilename);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

interface OpfsWorkspace {
  readonly root: FileSystemDirectoryHandle;
  readonly jobDir: string;
  readonly dir: FileSystemDirectoryHandle;
}

interface RemuxJobOptions {
  readonly media: MediaPlaylistAnalysis;
  readonly audioMedia?: MediaPlaylistAnalysis | null;
  readonly mediaPlaylistUrl: string;
  readonly parallel: number;
  readonly outputFormat: OutputFormat;
  readonly outputFilename: string;
  readonly embeddedSubtitle: string | null;
  readonly signal: AbortSignal;
}

function setDownloadTabKeepAlive(keepAlive: boolean): Promise<void> {
  return chrome.runtime
    .sendMessage({ type: "set-download-tab-keepalive", keepAlive })
    .then(() => undefined)
    .catch(() => undefined);
}

async function withDownloadTabKeepAlive<T>(task: () => Promise<T>): Promise<T> {
  appState.keepAliveDepth += 1;
  if (appState.keepAliveDepth === 1) await setDownloadTabKeepAlive(true);

  try {
    return await task();
  } finally {
    appState.keepAliveDepth = Math.max(0, appState.keepAliveDepth - 1);
    if (appState.keepAliveDepth === 0) await setDownloadTabKeepAlive(false);
  }
}

async function cleanupOpfsDirectory(
  root: FileSystemDirectoryHandle,
  dirName: string,
): Promise<void> {
  for (const delayMs of [0, 60, 180]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      await root.removeEntry(dirName, { recursive: true });

      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return;
      }
    }
  }
}

const OPFS_CHECKPOINT_FILE = "checkpoint.json";

async function readOpfsResumeUpdatedAt(
  root: FileSystemDirectoryHandle,
  dirName: string,
): Promise<number> {
  try {
    const dir = await root.getDirectoryHandle(dirName);
    const handle = await dir.getFileHandle(OPFS_CHECKPOINT_FILE);
    const text = await (await handle.getFile()).text();
    const parsed = JSON.parse(text) as { updatedAt?: unknown };

    return typeof parsed.updatedAt === "number" &&
      Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : 0;
  } catch {
    return 0;
  }
}

async function sweepStaleOpfsJobs(activeJobDir: string | null): Promise<void> {
  if (!navigator.storage?.getDirectory) return;

  try {
    const root = await navigator.storage.getDirectory();

    if (typeof root.keys !== "function") return;
    const names: string[] = [];

    for await (const name of root.keys()) names.push(name);

    for (const staleName of staleOpfsJobNames(names, activeJobDir)) {
      await cleanupOpfsDirectory(root, staleName);
    }

    const resumeEntries: { name: string; updatedAt: number }[] = [];

    for (const name of names) {
      if (!name.startsWith(OPFS_RESUME_PREFIX) || name === activeJobDir) {
        continue;
      }

      resumeEntries.push({
        name,
        updatedAt: await readOpfsResumeUpdatedAt(root, name),
      });
    }

    for (const expiredName of expiredResumeJobNames(
      resumeEntries,
      activeJobDir,
      Date.now(),
    )) {
      await cleanupOpfsDirectory(root, expiredName);
    }
  } catch {
    // Ignore storage cleanup failures when OPFS is unavailable.
  }
}

async function tryOpenOpfsWorkspace(
  jobDirOverride?: string,
): Promise<OpfsWorkspace | null> {
  if (!navigator.storage?.getDirectory) return null;

  try {
    const root = await navigator.storage.getDirectory();
    const jobDir = jobDirOverride || `${OPFS_JOB_PREFIX}${crypto.randomUUID()}`;
    const dir = await root.getDirectoryHandle(jobDir, { create: true });
    const probeHandle = await dir.getFileHandle("probe.tmp", { create: true });

    if (typeof probeHandle.createWritable !== "function") {
      await cleanupOpfsDirectory(root, jobDir);

      return null;
    }

    await dir.removeEntry("probe.tmp").catch(() => {});

    return Object.freeze({ root, jobDir, dir });
  } catch {
    return null;
  }
}

interface OpfsPartWriterState {
  partIndex: number;
  currentPartName: string;
  currentHandle: FileSystemFileHandle | null;
  writable: FileSystemWritableFileStream | null;
  currentPartSegments: number;
  ioFailed: boolean;
}

async function saveOpfsCheckpoint(
  dir: FileSystemDirectoryHandle,
  checkpoint: OpfsResumeCheckpoint,
): Promise<void> {
  const handle = await dir.getFileHandle(OPFS_CHECKPOINT_FILE, {
    create: true,
  });

  const writable = await handle.createWritable();

  await writable.write(JSON.stringify(checkpoint));
  await writable.close();
}

async function resetOpfsPartsDirectory(
  dir: FileSystemDirectoryHandle,
): Promise<void> {
  const toRemove: string[] = [];

  for await (const name of dir.keys()) {
    if (name === OPFS_CHECKPOINT_FILE || /^part-\d+\.ts$/i.test(name)) {
      toRemove.push(name);
    }
  }

  for (const name of toRemove) {
    await dir.removeEntry(name).catch(() => {});
  }
}

async function loadOpfsCheckpoint(
  dir: FileSystemDirectoryHandle,
  totalSegments: number,
): Promise<OpfsResumeCheckpoint | null> {
  try {
    const existingSizes = new Map<string, number>();

    for await (const name of dir.keys()) {
      if (!/^part-\d{6}\.ts$/.test(name)) continue;
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();

      existingSizes.set(name, file.size);
    }

    const checkpointHandle = await dir.getFileHandle(OPFS_CHECKPOINT_FILE);
    const parsed = JSON.parse(await (await checkpointHandle.getFile()).text());

    const validated = validateResumeCheckpoint(
      parsed,
      totalSegments,
      existingSizes,
    );

    if (validated) return validated;
  } catch {
    // Missing or unreadable checkpoint starts cleanly from segment 1.
  }

  await resetOpfsPartsDirectory(dir);

  return null;
}

async function sealCurrentOpfsPart(
  dir: FileSystemDirectoryHandle,
  totalSegments: number,
  sealedParts: OpfsCheckpointPart[],
  writerState: OpfsPartWriterState,
): Promise<void> {
  const writable = writerState.writable;

  if (!writable) return;
  writerState.writable = null;
  await writable.close();

  const handle = writerState.currentHandle;
  const partName = writerState.currentPartName;
  const segmentCount = writerState.currentPartSegments;

  writerState.currentHandle = null;
  writerState.currentPartName = "";
  writerState.currentPartSegments = 0;

  if (!handle || !partName || segmentCount <= 0) return;

  const file = await handle.getFile();

  if (!file.size) {
    await dir.removeEntry(partName).catch(() => {});

    return;
  }

  sealedParts.push(
    Object.freeze({
      name: partName,
      segments: segmentCount,
      bytes: file.size,
    }),
  );

  const completedSegments = sealedParts.reduce(
    (sum, part) => sum + part.segments,
    0,
  );

  await saveOpfsCheckpoint(dir, {
    totalSegments,
    completedSegments,
    updatedAt: Date.now(),
    parts: sealedParts,
  });
}

async function openNextOpfsPart(
  dir: FileSystemDirectoryHandle,
  totalSegments: number,
  sealedParts: OpfsCheckpointPart[],
  writerState: OpfsPartWriterState,
): Promise<FileSystemWritableFileStream> {
  await sealCurrentOpfsPart(dir, totalSegments, sealedParts, writerState);
  writerState.partIndex += 1;
  const partName = `part-${String(writerState.partIndex).padStart(6, "0")}.ts`;
  const handle = await dir.getFileHandle(partName, { create: true });
  const writable = await handle.createWritable();

  writerState.currentPartName = partName;
  writerState.currentHandle = handle;
  writerState.writable = writable;
  writerState.currentPartSegments = 0;

  return writable;
}

async function writeGroupChunksToOpfs(
  dir: FileSystemDirectoryHandle,
  totalSegments: number,
  partLimit: number,
  segmentGroup: readonly MediaSegment[],
  bytes: readonly Uint8Array[],
  start: number,
  writerState: OpfsPartWriterState,
  sealedParts: OpfsCheckpointPart[],
): Promise<void> {
  for (const [offset, chunk] of bytes.entries()) {
    const segmentIndex = start + offset;

    const needsNewPart =
      !writerState.writable ||
      writerState.currentPartSegments >= partLimit ||
      shouldSplitDiscontinuityPart(
        Boolean(segmentGroup[offset]?.discontinuity),
        segmentIndex,
      );

    const writable = needsNewPart
      ? await openNextOpfsPart(dir, totalSegments, sealedParts, writerState)
      : writerState.writable;

    if (writable) {
      try {
        await writable.write(chunk as BlobPart);
      } catch (writeError) {
        writerState.ioFailed = true;
        throw writeError;
      }

      writerState.currentPartSegments += 1;
    }

    progress.value = segmentIndex + 1;
  }
}

async function fetchOrderedSegmentGroups(
  media: MediaPlaylistAnalysis,
  parallel: number,
  signal: AbortSignal,
  onGroup: (
    segmentGroup: readonly MediaSegment[],
    bytes: readonly Uint8Array[],
    start: number,
  ) => Promise<void>,
  startSegmentIndex = 0,
): Promise<void> {
  const loopState = {
    cursor: startSegmentIndex,
    effectiveParallel: clampConcurrency(parallel),
  };

  while (loopState.cursor < media.segments.length) {
    throwIfAborted(signal);
    const batchParallel = loopState.effectiveParallel;

    const [segmentGroup] = orderedSegmentGroups(
      media.segments.slice(loopState.cursor, loopState.cursor + batchParallel),
      batchParallel,
    );

    if (!segmentGroup?.length) break;

    const start = loopState.cursor;
    const batchState = { steppedDown: false };

    setStatus(
      "Fetching source segments…",
      `Segments ${start + 1}–${start + segmentGroup.length} of ${media.segments.length} · ${batchParallel} parallel`,
    );

    const bytes = await fetchSegmentGroup(segmentGroup, signal, (status) => {
      if (!batchState.steppedDown) {
        batchState.steppedDown = true;

        loopState.effectiveParallel = nextAdaptiveConcurrency(
          loopState.effectiveParallel,
          true,
        );
      }

      setStatus(
        "Server busy — pausing briefly…",
        `HTTP ${status} on segments ${start + 1}–${start + segmentGroup.length} of ${media.segments.length} · retrying at ${loopState.effectiveParallel} parallel`,
      );
    });

    await onGroup(segmentGroup, bytes, start);
    loopState.cursor += segmentGroup.length;

    persistRun({
      completedSegments: progress.value,
      totalSegments: media.segments.length,
    });
  }
}

async function writeSegmentsToOpfs(
  dir: FileSystemDirectoryHandle,
  media: MediaPlaylistAnalysis,
  parallel: number,
  signal: AbortSignal,
): Promise<string[]> {
  const checkpoint = await loadOpfsCheckpoint(dir, media.segments.length);

  const sealedParts: OpfsCheckpointPart[] = checkpoint
    ? [...checkpoint.parts]
    : [];

  const startSegmentIndex = checkpoint ? checkpoint.completedSegments : 0;
  const partLimit = checkpointPartSize(media.segments.length);

  const writerState: OpfsPartWriterState = {
    partIndex: sealedParts.length,
    currentPartName: "",
    currentHandle: null,
    writable: null,
    currentPartSegments: 0,
    ioFailed: false,
  };

  if (startSegmentIndex > 0) {
    progress.value = startSegmentIndex;

    setStatus(
      "Resuming download…",
      `Resuming from segment ${startSegmentIndex + 1} of ${media.segments.length}…`,
    );
  }

  try {
    await fetchOrderedSegmentGroups(
      media,
      parallel,
      signal,
      (segmentGroup, bytes, start) =>
        writeGroupChunksToOpfs(
          dir,
          media.segments.length,
          partLimit,
          segmentGroup,
          bytes,
          start,
          writerState,
          sealedParts,
        ),
      startSegmentIndex,
    );

    await sealCurrentOpfsPart(
      dir,
      media.segments.length,
      sealedParts,
      writerState,
    );

    return sealedParts.map((part) => part.name);
  } catch (error) {
    if (!writerState.ioFailed && writerState.currentPartSegments > 0) {
      await sealCurrentOpfsPart(
        dir,
        media.segments.length,
        sealedParts,
        writerState,
      ).catch(() => {});
    }

    if (writerState.writable) {
      const partialName = writerState.currentPartName;

      await writerState.writable.abort().catch(() => {});
      writerState.writable = null;
      if (partialName) await dir.removeEntry(partialName).catch(() => {});
    }

    throw error;
  }
}

function attachFfmpegProgressStatus(
  ffmpeg: FFmpeg,
  outputFormat: OutputFormat,
  totalDurationSeconds: number,
): void {
  const progressState: { lastUpdateAt: number; faststart: boolean } = {
    lastUpdateAt: 0,
    faststart: false,
  };

  ffmpeg.on("log", ({ message: logMessage }) => {
    const parsed = parseFfmpegProgressLine(logMessage, totalDurationSeconds);

    if (!parsed) return;

    if (parsed.phase === "faststart") {
      if (progressState.faststart) return;
      progressState.faststart = true;

      setStatus(
        `Finalizing ${outputFormat.toUpperCase()}…`,
        "Moving video index to the start for instant playback…",
      );

      return;
    }

    const now = Date.now();

    if (progressState.faststart || now - progressState.lastUpdateAt < 350) {
      return;
    }

    progressState.lastUpdateAt = now;

    setStatus(
      `Creating a standard ${outputFormat.toUpperCase()}…`,
      parsed.percent !== null
        ? `FFmpeg is copying H.264/AAC streams without re-encoding… ${parsed.percent}%`
        : "FFmpeg is copying H.264/AAC streams without re-encoding…",
    );
  });
}

async function streamOrderedSegmentsWithDiscontinuities(
  media: MediaPlaylistAnalysis,
  parallel: number,
  signal: AbortSignal,
  trackProgress: boolean,
  onDiscontinuity: () => Promise<void>,
  onChunk: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
  await fetchOrderedSegmentGroups(
    media,
    parallel,
    signal,
    async (segmentGroup, bytes, start) => {
      for (const [offset, chunk] of bytes.entries()) {
        const segment = segmentGroup[offset];

        if (
          shouldSplitDiscontinuityPart(
            Boolean(segment?.discontinuity),
            start + offset,
          )
        ) {
          await onDiscontinuity();
        }

        await onChunk(chunk);
        if (trackProgress) progress.value = start + offset + 1;
      }
    },
  );
}

async function writeMediaStreamToOpfs(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  media: MediaPlaylistAnalysis,
  parallel: number,
  signal: AbortSignal,
  trackProgress: boolean,
): Promise<string[]> {
  if (!media.map && prefix === "part") {
    return writeSegmentsToOpfs(dir, media, parallel, signal);
  }

  const initBytes = media.map
    ? await fetchSegment({ uri: media.map.uri, range: media.map.range }, signal)
    : null;

  const extension = media.map ? "mp4" : "ts";
  const partNames: string[] = [];

  const streamState: {
    partIndex: number;
    writable: FileSystemWritableFileStream | null;
  } = { partIndex: 0, writable: null };

  const openPart = async (): Promise<void> => {
    const name = `${prefix}-${String(streamState.partIndex).padStart(6, "0")}.${extension}`;
    const handle = await dir.getFileHandle(name, { create: true });

    streamState.writable = await handle.createWritable();
    partNames.push(name);
    streamState.partIndex += 1;

    if (initBytes) await streamState.writable.write(new Uint8Array(initBytes));
  };

  try {
    await openPart();

    await streamOrderedSegmentsWithDiscontinuities(
      media,
      parallel,
      signal,
      trackProgress,
      async () => {
        await streamState.writable?.close();
        streamState.writable = null;
        await openPart();
      },
      async (chunk) => {
        await streamState.writable?.write(new Uint8Array(chunk));
      },
    );

    await streamState.writable?.close();
    streamState.writable = null;

    return partNames;
  } catch (error) {
    await streamState.writable?.abort().catch(() => {});
    streamState.writable = null;
    throw error;
  }
}

async function writeMediaStreamToMemfs(
  ffmpeg: FFmpeg,
  prefix: string,
  media: MediaPlaylistAnalysis,
  parallel: number,
  signal: AbortSignal,
  trackProgress: boolean,
): Promise<string[]> {
  if (!media.map) {
    const partPaths: string[] = [];

    await fetchOrderedSegmentGroups(
      media,
      parallel,
      signal,
      async (_segmentGroup, bytes, start) => {
        for (const [offset, chunk] of bytes.entries()) {
          const partName = `${prefix}-${String(start + offset + 1).padStart(6, "0")}.ts`;

          await ffmpeg.writeFile(partName, chunk, { signal });
          partPaths.push(partName);
          if (trackProgress) progress.value = start + offset + 1;
        }
      },
    );

    return partPaths;
  }

  const initBytes = await fetchSegment(
    { uri: media.map.uri, range: media.map.range },
    signal,
  );

  const partChunks: Uint8Array[][] = [[initBytes]];

  await streamOrderedSegmentsWithDiscontinuities(
    media,
    parallel,
    signal,
    trackProgress,
    async () => {
      partChunks.push([initBytes]);
    },
    async (chunk) => {
      partChunks.at(-1)?.push(chunk);
    },
  );

  const partPaths: string[] = [];

  for (const [partIndex, chunks] of partChunks.entries()) {
    const totalLength = chunks.reduce((sum, item) => sum + item.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    const offsetState = { byteOffset: 0 };

    for (const chunk of chunks) {
      merged.set(chunk, offsetState.byteOffset);
      offsetState.byteOffset += chunk.byteLength;
    }

    const partName = `${prefix}-${String(partIndex).padStart(6, "0")}.mp4`;

    await ffmpeg.writeFile(partName, merged, { signal });
    partPaths.push(partName);
  }

  return partPaths;
}

function buildInputArgs(
  partPaths: readonly string[],
  manifestName: string,
): { readonly args: readonly string[]; readonly needsConcat: boolean } {
  if (partPaths.length === 1 && partPaths[0]?.endsWith(".mp4")) {
    return { args: ["-i", partPaths[0]], needsConcat: false };
  }

  return {
    args: [
      "-f",
      "concat",
      "-safe",
      "0",
      "-fflags",
      "+genpts",
      "-i",
      manifestName,
    ],
    needsConcat: true,
  };
}

function buildFfmpegRemuxArgs(
  outputPath: string,
  outputFormat: OutputFormat,
  embeddedSubtitle: string | null,
  videoInputArgs: readonly string[],
  audioInputArgs: readonly string[],
): string[] {
  const hasSeparateAudio = audioInputArgs.length > 0;
  const subtitleInputIndex = hasSeparateAudio ? 2 : 1;

  return [
    ...videoInputArgs,
    ...audioInputArgs,
    ...(embeddedSubtitle ? ["-i", "subtitle.vtt"] : []),
    "-map",
    "0:v:0",
    "-map",
    hasSeparateAudio ? "1:a:0" : "0:a:0?",
    ...(embeddedSubtitle ? ["-map", `${subtitleInputIndex}:0`] : []),
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    ...(embeddedSubtitle
      ? ["-c:s", "webvtt", "-disposition:s:0", "default"]
      : []),
    "-avoid_negative_ts",
    "make_zero",
    ...(outputFormat === "mp4" ? ["-movflags", "+faststart"] : []),
    outputPath,
  ];
}

async function runFfmpegConcatRemux({
  ffmpeg,
  partPaths,
  audioPartPaths = [],
  outputPath,
  outputFormat,
  embeddedSubtitle,
  signal,
}: {
  readonly ffmpeg: FFmpeg;
  readonly partPaths: readonly string[];
  readonly audioPartPaths?: readonly string[];
  readonly outputPath: string;
  readonly outputFormat: OutputFormat;
  readonly embeddedSubtitle: string | null;
  readonly signal: AbortSignal;
}): Promise<number> {
  setStatus(
    `Creating a standard ${outputFormat.toUpperCase()}…`,
    "FFmpeg is copying H.264/AAC streams without re-encoding…",
  );

  const videoInput = buildInputArgs(partPaths, "segments.txt");

  if (videoInput.needsConcat) {
    const concatList = buildConcatManifest(partPaths);

    await ffmpeg.writeFile(
      "segments.txt",
      new TextEncoder().encode(concatList),
      {
        signal,
      },
    );
  }

  const audioInput = audioPartPaths.length
    ? buildInputArgs(audioPartPaths, "audio-segments.txt")
    : { args: [], needsConcat: false };

  if (audioInput.needsConcat) {
    const audioConcatList = buildConcatManifest(audioPartPaths);

    await ffmpeg.writeFile(
      "audio-segments.txt",
      new TextEncoder().encode(audioConcatList),
      { signal },
    );
  }

  if (embeddedSubtitle) {
    await ffmpeg.writeFile(
      "subtitle.vtt",
      new TextEncoder().encode(embeddedSubtitle),
      { signal },
    );
  }

  return ffmpeg.exec(
    buildFfmpegRemuxArgs(
      outputPath,
      outputFormat,
      embeddedSubtitle,
      videoInput.args,
      audioInput.args,
    ),
    -1,
    { signal },
  );
}

async function createAttachedFfmpeg(
  outputFormat: OutputFormat,
  totalDurationSeconds: number,
  signal: AbortSignal,
): Promise<{ readonly ffmpeg: FFmpeg; readonly stopFfmpeg: () => void }> {
  setStatus(
    "Loading the MP4 engine…",
    "Preparing lossless FFmpeg remuxing (one-time 32 MB engine load)…",
  );

  const ffmpeg = await createFfmpeg(signal);
  const stopFfmpeg = (): void => ffmpeg.terminate();

  signal.addEventListener("abort", stopFfmpeg, { once: true });
  attachFfmpegProgressStatus(ffmpeg, outputFormat, totalDurationSeconds);

  return { ffmpeg, stopFfmpeg };
}

async function remuxWithOpfsWorkspace(
  workspace: OpfsWorkspace,
  options: RemuxJobOptions,
): Promise<number> {
  const {
    media,
    audioMedia = null,
    parallel,
    outputFormat,
    outputFilename,
    embeddedSubtitle,
    signal,
  } = options;

  const outputName = `output.${outputFormat}`;
  const mountPoint = "/opfs";
  const jobOutcome = { completed: false };

  appState.activeOpfsJobDir = workspace.jobDir;

  try {
    const partNames = await writeMediaStreamToOpfs(
      workspace.dir,
      "part",
      media,
      parallel,
      signal,
      true,
    );

    const audioPartNames = audioMedia
      ? await writeMediaStreamToOpfs(
          workspace.dir,
          "audio-part",
          audioMedia,
          parallel,
          signal,
          false,
        )
      : [];

    await workspace.dir.removeEntry(outputName).catch(() => {});

    const { ffmpeg, stopFfmpeg } = await createAttachedFfmpeg(
      outputFormat,
      media.totalDurationSeconds,
      signal,
    );

    try {
      await ffmpeg.mountOpfs(
        {
          jobDir: workspace.jobDir,
          readOnlyFiles: [...partNames, ...audioPartNames],
          readWriteFiles: [outputName],
          mountPoint,
        },
        { signal },
      );

      const exitCode = await runFfmpegConcatRemux({
        ffmpeg,
        partPaths: partNames.map((name) => `${mountPoint}/${name}`),
        audioPartPaths: audioPartNames.map((name) => `${mountPoint}/${name}`),
        outputPath: `${mountPoint}/${outputName}`,
        outputFormat,
        embeddedSubtitle,
        signal,
      });

      await ffmpeg.unmountOpfs(mountPoint, { signal }).catch(() => {});

      if (exitCode !== 0) {
        throw new Error(
          `FFmpeg could not create this ${outputFormat.toUpperCase()} file (exit code ${exitCode}).`,
        );
      }

      ffmpeg.terminate();
    } finally {
      signal.removeEventListener("abort", stopFfmpeg);
      ffmpeg.terminate();
    }

    for (const partName of [...partNames, ...audioPartNames]) {
      await workspace.dir.removeEntry(partName).catch(() => {});
    }

    const outputHandle = await workspace.dir.getFileHandle(outputName);
    const outputFile = await outputHandle.getFile();

    if (!outputFile.size) {
      throw new Error(
        `FFmpeg produced an empty ${outputFormat.toUpperCase()} file.`,
      );
    }

    setStatus(
      `Saving ${outputFormat.toUpperCase()} to Downloads…`,
      `${formatBytes(outputFile.size)} ready — saving directly from local buffer…`,
    );

    await saveBrowserDownload(
      outputFile,
      outputFilename,
      outputFormat === "mkv" ? "video/x-matroska" : "video/mp4",
      signal,
    );

    jobOutcome.completed = true;

    return outputFile.size;
  } finally {
    appState.activeOpfsJobDir = null;

    if (jobOutcome.completed) {
      await cleanupOpfsDirectory(workspace.root, workspace.jobDir);
    }

    if (!jobOutcome.completed) {
      await workspace.dir.removeEntry(outputName).catch(() => {});
    }
  }
}

async function remuxWithMemfsFallback(
  options: RemuxJobOptions,
): Promise<number> {
  const {
    media,
    audioMedia = null,
    parallel,
    outputFormat,
    outputFilename,
    embeddedSubtitle,
    signal,
  } = options;

  const { ffmpeg, stopFfmpeg } = await createAttachedFfmpeg(
    outputFormat,
    media.totalDurationSeconds,
    signal,
  );

  try {
    const partPaths = await writeMediaStreamToMemfs(
      ffmpeg,
      "segment",
      media,
      parallel,
      signal,
      true,
    );

    const audioPartPaths = audioMedia
      ? await writeMediaStreamToMemfs(
          ffmpeg,
          "audio-segment",
          audioMedia,
          parallel,
          signal,
          false,
        )
      : [];

    const outputPath = `output.${outputFormat}`;

    const exitCode = await runFfmpegConcatRemux({
      ffmpeg,
      partPaths,
      audioPartPaths,
      outputPath,
      outputFormat,
      embeddedSubtitle,
      signal,
    });

    for (const partPath of [
      ...partPaths,
      ...audioPartPaths,
      "segments.txt",
      "audio-segments.txt",
    ]) {
      await ffmpeg.deleteFile(partPath, { signal }).catch(() => {});
    }

    if (exitCode !== 0) {
      throw new Error(
        `FFmpeg could not create this ${outputFormat.toUpperCase()} file (exit code ${exitCode}).`,
      );
    }

    const output = await ffmpeg.takeFile(outputPath, { signal });

    if (!(output instanceof Uint8Array) || !output.byteLength) {
      throw new Error(
        `FFmpeg produced an empty ${outputFormat.toUpperCase()} file.`,
      );
    }

    ffmpeg.terminate();

    await saveBrowserDownload(
      output,
      outputFilename,
      outputFormat === "mkv" ? "video/x-matroska" : "video/mp4",
      signal,
    );

    return output.byteLength;
  } finally {
    signal.removeEventListener("abort", stopFfmpeg);
    ffmpeg.terminate();
  }
}

async function remuxSegmentsAndSave(options: RemuxJobOptions): Promise<number> {
  const resumeJobDir = canonicalResumeStreamKey(
    options.mediaPlaylistUrl,
    options.media.segments.length,
  );

  const workspace = await tryOpenOpfsWorkspace(resumeJobDir);

  if (workspace) {
    return remuxWithOpfsWorkspace(workspace, options);
  }

  return remuxWithMemfsFallback(options);
}

async function finalizePostDownloadSubtitle({
  selectedSubtitleTrack,
  outputFormat,
  outputFilename,
  segmentCount,
  outputBytes,
  embeddedSubtitle,
  signal,
}: {
  readonly selectedSubtitleTrack: KnownSubtitleTrack | null;
  readonly outputFormat: OutputFormat;
  readonly outputFilename: string;
  readonly segmentCount: number;
  readonly outputBytes: number;
  readonly embeddedSubtitle: string | null;
  readonly signal: AbortSignal;
}): Promise<void> {
  if (!selectedSubtitleTrack || outputFormat !== "mp4") {
    const subtitleSummary = embeddedSubtitle ? " · subtitle embedded" : "";

    setStatus(
      `${outputFormat.toUpperCase()} download finished`,
      `${segmentCount} segments · ${formatBytes(outputBytes)} saved to Downloads / ${currentDownloadSubfolder()}${subtitleSummary}.`,
    );

    return;
  }

  try {
    const subtitleName = subtitleFilename(
      outputFilename,
      selectedSubtitleTrack.url,
    );

    if (!isAlreadyDownloadedFile(subtitleName)) {
      const contents = await subtitleText(selectedSubtitleTrack, signal);

      await saveBrowserDownload(contents, subtitleName, "text/vtt");
    }

    setStatus(
      "MP4 and subtitle finished",
      `${segmentCount} segments · ${formatBytes(outputBytes)} saved to Downloads / ${currentDownloadSubfolder()}.`,
    );
  } catch (subtitleError) {
    console.error("OPFS Media Packager subtitle download", subtitleError);

    setStatus(
      "Video finished; subtitle unavailable",
      "The video was saved, but the selected subtitle could not be added. Try the subtitle again from the video page.",
    );
  }
}

async function startDownload(): Promise<"completed" | "cancelled"> {
  if (!appState.playlistAnalysis) {
    throw new Error("Analyze the manifest first.");
  }

  const sourceUrl = playlistUrl.value.trim();

  const selected =
    appState.playlistAnalysis.qualityOptions[Number(qualitySelect.value)];

  const outputFormat = outputFormatOrDefault(container.value);
  const outputFilename = mediaFilename(filename.value, outputFormat);
  const selectedSubtitleTrack = appState.selectedSubtitleTrack;

  const controller = new AbortController();

  appState.controller = controller;

  appState.activeDownloadJob = Object.freeze({
    state: "running",
    filename: outputFilename,
    completedSegments: 0,
    totalSegments: 0,
    startedAt: Date.now(),
  });

  persistRun({});
  setBusy(true, true);

  return withDownloadTabKeepAlive(
    async (): Promise<"completed" | "cancelled"> => {
      try {
        setStatus("Reading selected quality…");

        const selectedMediaUrl = selected.uri || sourceUrl;

        const media = parsePlaylist(
          await fetchText(selectedMediaUrl, controller.signal),
          selectedMediaUrl,
        );

        if (media.type !== "media") {
          throw new Error("Nested master manifests are not supported.");
        }

        if (!media.complete) {
          throw new Error("Live or unfinished playlists are not supported.");
        }

        const audioMedia = selected.audioUri
          ? parsePlaylist(
              await fetchText(selected.audioUri, controller.signal),
              selected.audioUri,
            )
          : null;

        if (
          audioMedia &&
          (audioMedia.type !== "media" || !audioMedia.complete)
        ) {
          throw new Error("Separate audio manifest is incomplete or invalid.");
        }

        progress.max = media.segments.length;
        progress.value = 0;
        persistRun({ totalSegments: media.segments.length });

        const embeddedSubtitle =
          selectedSubtitleTrack && outputFormat === "mkv"
            ? await subtitleText(selectedSubtitleTrack, controller.signal)
            : null;

        const outputBytes = await remuxSegmentsAndSave({
          media,
          audioMedia: audioMedia?.type === "media" ? audioMedia : null,
          mediaPlaylistUrl: selectedMediaUrl,
          parallel: clampConcurrency(Number(concurrency.value)),
          outputFormat,
          outputFilename,
          embeddedSubtitle,
          signal: controller.signal,
        });

        await finalizePostDownloadSubtitle({
          selectedSubtitleTrack,
          outputFormat,
          outputFilename,
          segmentCount: media.segments.length,
          outputBytes,
          embeddedSubtitle,
          signal: controller.signal,
        });

        if (
          !appState.trackRunActive &&
          appState.singleDownloadDocuments &&
          countTopicCompanionDocuments(appState.singleDownloadDocuments) > 0
        ) {
          const singleTitle = outputFilename.replace(/\.(?:mp4|mkv)$/i, "");

          await downloadTopicCompanionDocuments(
            singleTitle,
            appState.singleDownloadDocuments,
            controller.signal,
          );
        }

        persistRun({
          state: "completed",
          completedSegments: media.segments.length,
        });

        return "completed";
      } catch (error) {
        if (isAbortError(error)) {
          persistRun({ state: "cancelled" });

          setStatus(
            "Download cancelled",
            "The partially written output file was discarded.",
          );

          return "cancelled";
        }

        persistRun({ state: "failed", error: errorMessageOf(error) });
        throw error;
      } finally {
        if (appState.activeDownloadJob?.state === "running") {
          persistRun({
            state: "interrupted",
            error:
              "The download page was closed or an unexpected error interrupted the run.",
          });
        }

        appState.controller = null;
        appState.activeDownloadJob = null;
        setBusy(false);
      }
    },
  );
}

/** Chooses the HLS manifest for one requested video quality in a playlist item. */
function preferredTopicQuality(
  item: TrackTopicDownload,
  preference: string,
  trackQualityPreference = "best",
): VideoQualityOption | null {
  const qualityOptions = item.qualityOptions || [];

  if (trackQualityPreference === "smallest") {
    return qualityOptions.at(-1) || null;
  }

  const maximumHeight = Number(trackQualityPreference);

  if (Number.isFinite(maximumHeight) && maximumHeight > 0) {
    return (
      qualityOptions.find(
        (qualityOption) =>
          Number.parseInt(qualityOption.label, 10) <= maximumHeight,
      ) ||
      qualityOptions.at(-1) ||
      null
    );
  }

  return (
    qualityOptions.find(
      (qualityOption) => qualityOption.label === preference,
    ) ||
    qualityOptions[0] ||
    null
  );
}

/** Applies the playlist-wide settings to one item before downloading it. */
async function prepareTrackTopic(
  item: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
): Promise<void> {
  // Earlier releases stored these two names. Read them only to keep a saved
  // quality choice while writing the current preferredQualityLabel key.
  const {
    preferredQualityLabel = "",
    renditionPreference: legacyRenditionPreference = "",
    qualityPreference: legacyQualityPreference = "",
  } = await chrome.storage.local.get({
    preferredQualityLabel: "",
    renditionPreference: "",
    qualityPreference: "",
  });

  const outputFormat = outputFormatOrDefault(
    trackDownload.outputFormat || DEFAULT_DOWNLOAD_PREFERENCES.outputFormat,
  );

  const topicSourceUrl = item.url || "";

  const keepManualSelection =
    Boolean(topicSourceUrl) &&
    appState.userSelectedQualityForUrl === topicSourceUrl &&
    Boolean(appState.selectedQualityPlaylistUrl) &&
    Boolean(
      item.qualityOptions?.some(
        (option) => option.url === appState.selectedQualityPlaylistUrl,
      ),
    );

  if (!keepManualSelection) {
    const qualityOption = preferredTopicQuality(
      item,
      trackDownload.preferredQualityLabel ||
        String(
          preferredQualityLabel ||
            legacyRenditionPreference ||
            legacyQualityPreference ||
            "",
        ),
      trackDownload.trackQualityPreference,
    );

    appState.selectedQualityPlaylistUrl = qualityOption?.url || topicSourceUrl;
    appState.userSelectedQualityForUrl = "";
  }

  appState.selectedSubtitleTrack =
    trackDownload.subtitleDownloadPreference === "none"
      ? null
      : item.subtitles?.[0] || null;

  appState.sourceTabId = trackDownload.sourceTabId ?? null;
  appState.sourcePageUrl = item.sourceUrl || "";
  appState.trackFolderSegments = item.folderPath || [];
  videoTitle.textContent = item.title || "Video topic";
  sourceHost.textContent = "Track topic";
  container.value = outputFormat;

  concurrency.value = String(
    clampConcurrency(
      Number(trackDownload.segmentConcurrency || DEFAULT_SEGMENT_CONCURRENCY),
    ),
  );

  filename.value = mediaFilename(item.title || "video", outputFormat);
  playlistUrl.value = item.url || "";
  subtitleNote.hidden = !appState.selectedSubtitleTrack;

  subtitleNote.textContent = appState.selectedSubtitleTrack
    ? `${appState.selectedSubtitleTrack.language} is ${outputFormat === "mkv" ? "embedded in the MKV" : "saved as a matching VTT file"}.`
    : "";

  updateOutputNote();

  await chrome.runtime
    .sendMessage({
      type: "authorize-download-media",
      url: appState.selectedQualityPlaylistUrl || item.url || "",
      sourceUrl: appState.sourcePageUrl,
    })
    .catch(() => {});

  if (item.qualityOptions?.length) {
    applyQualityChoices(suppliedQualityChoices(item.qualityOptions));

    return;
  }

  await analyze();
}

async function recordCompletedTrackTopic(
  item: TrackTopicDownload,
): Promise<void> {
  if (typeof item.topicIndex !== "number") return;

  appState.trackCompletedIndices.add(item.topicIndex);

  if (appState.activeTrackDownload) {
    appState.activeTrackDownload = {
      ...appState.activeTrackDownload,
      completedTopicIndices: [...appState.trackCompletedIndices],
    };
  }

  if (!trackDownloadId) return;

  await chrome.runtime
    .sendMessage({
      type: "complete-track-download-topic",
      trackDownloadId,
      topicIndex: item.topicIndex,
    })
    .catch(() => {});
}

function isTopicAlreadyCompleted(
  item: TrackTopicDownload,
  completedSet: ReadonlySet<number>,
): boolean {
  return (
    typeof item.topicIndex === "number" && completedSet.has(item.topicIndex)
  );
}

type TrackTopicFailureKind = RemuxErrorKind;

type TrackTopicAttempt =
  | { readonly status: "completed"; readonly skippedExisting?: boolean }
  | { readonly status: "cancelled" }
  | {
      readonly status: "failed";
      readonly kind: TrackTopicFailureKind;
      readonly message: string;
    };

/** Context required to process one ordered item in a playlist queue. */
interface TrackQueueTopicContext {
  readonly index: number;
  readonly item: TrackTopicDownload;
  readonly totalTopics: number;
  readonly initialPlan: TrackDownloadPlan;
  readonly queueState: TrackQueueState;
  readonly runStats: { downloaded: number; skippedExisting: number };
  readonly failures: string[];
}

function classifyTrackTopicFailure(errorText: string): TrackTopicFailureKind {
  return classifyRemuxErrorKind(errorText);
}

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/svg": "svg",
  "image/avif": "avif",
});

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
});

interface ExportDiagramResponse {
  readonly ok?: boolean;
  readonly svg?: string;
  readonly error?: string;
}

interface ExportSlidesResponse {
  readonly ok?: boolean;
  readonly pdfBase64?: string;
  readonly error?: string;
}

interface DownloadedDocumentRecord {
  readonly url: string;
  readonly canonicalKey: string;
  readonly kind: TopicFileAsset["kind"] | "diagram" | "slides" | "note";
  readonly filename: string;
  readonly folderPath: readonly string[];
  readonly status: "downloaded" | "failed";
}

interface DocumentBatchContext {
  readonly topicTitle: string;
  readonly signal: AbortSignal;
  readonly usedFilenames: Set<string>;
  readonly downloadedDocumentsByKey: Map<string, DownloadedDocumentRecord>;
  readonly topicArtifacts: DownloadedArtifactAnnotation[];
  readonly currentFolderPath: readonly string[];
  readonly warnings: string[];
  readonly onStepDone?: () => void;
}

function inferImageExtension(
  filenameValue: string,
  contentType: string,
): string {
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  const extensionByMimeType = IMAGE_CONTENT_TYPES[mimeType];

  if (extensionByMimeType) return extensionByMimeType;

  const extensionMatch = /\.(png|jpe?g|webp|gif|svg)$/i.exec(
    filenameValue.trim(),
  );

  if (!extensionMatch) return "png";

  const extension = extensionMatch[1].toLowerCase();

  return extension === "jpeg" ? "jpg" : extension;
}

const GENERIC_FILE_MIME_EXTENSIONS: Readonly<Record<string, string>> =
  Object.freeze({
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "text/csv": "csv",
    "text/plain": "txt",
    "text/markdown": "md",
    "application/json": "json",
    "application/pdf": "pdf",
  });

function inferGenericFileExtension(
  filenameValue: string,
  contentType: string,
): string {
  const extensionMatch = /\.([a-z0-9]{2,6})$/i.exec(filenameValue.trim());

  if (extensionMatch) return extensionMatch[1].toLowerCase();

  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  return GENERIC_FILE_MIME_EXTENSIONS[mimeType] || "bin";
}

function genericFileMimeType(contentType: string): string {
  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  return mimeType || "application/octet-stream";
}

function resolvedFileAssetFormat(
  kind: TopicFileAsset["kind"],
  assetFilename: string,
  contentType: string,
): { readonly extension: string; readonly mimeType: string } {
  if (kind === "pdf") {
    return { extension: "pdf", mimeType: "application/pdf" };
  }

  if (kind === "image") {
    const extension = inferImageExtension(assetFilename, contentType);

    return { extension, mimeType: imageMimeType(extension) };
  }

  return {
    extension: inferGenericFileExtension(assetFilename, contentType),
    mimeType: genericFileMimeType(contentType),
  };
}

function imageMimeType(extension: string): string {
  return IMAGE_MIME_TYPES[extension] || "image/png";
}

function isValidDocumentPayload(
  kind: TopicFileAsset["kind"],
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (!bytes.byteLength) return false;

  const prefix = new TextDecoder("latin1")
    .decode(bytes.subarray(0, 32))
    .trimStart()
    .toLowerCase();

  const looksHtml =
    prefix.startsWith("<html") || prefix.startsWith("<!doctype");

  if (looksHtml) return false;
  if (kind !== "pdf") return true;

  return prefix.startsWith("%pdf-") || contentType.includes("pdf");
}

async function fetchWithCredentialFallback(
  safeUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(safeUrl, {
      cache: "no-store",
      credentials: "include",
      redirect: "follow",
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;

    return fetch(safeUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal,
    });
  }
}

async function fetchSingleDocumentCandidate(
  candidateUrl: string,
  kind: TopicFileAsset["kind"],
  fallbackContentType: string,
  signal: AbortSignal,
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string }> {
  const safeUrl = safeMediaUrl(candidateUrl);

  if (!safeUrl) throw new Error("Unsafe document URL.");

  const response = await fetchWithCredentialFallback(safeUrl, signal);

  if (response.url && !safeMediaUrl(response.url)) {
    throw new Error("Unsafe redirected document URL.");
  }

  if (!response.ok) {
    throw new Error(`Document request failed: HTTP ${response.status}.`);
  }

  const responseType = (
    response.headers.get("content-type") || ""
  ).toLowerCase();

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!isValidDocumentPayload(kind, bytes, responseType)) {
    throw new Error(`Invalid ${kind} document payload.`);
  }

  return Object.freeze({
    bytes,
    contentType: responseType || fallbackContentType.toLowerCase(),
  });
}

async function fetchDocumentFile(
  asset: TopicFileAsset,
  signal: AbortSignal,
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string }> {
  const candidates = [asset.url, asset.fallbackUrl].filter(
    (value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index,
  );

  const errorState: { lastError: unknown } = { lastError: null };

  for (const candidateUrl of candidates) {
    try {
      return await fetchSingleDocumentCandidate(
        candidateUrl,
        asset.kind,
        asset.contentType || "",
        signal,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      errorState.lastError = error;
    }
  }

  throw errorState.lastError instanceof Error
    ? errorState.lastError
    : new Error("Could not download companion document.");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Download cancelled", "AbortError");
  }
}

function peekUniqueDocumentFilename(
  candidate: string,
  usedFilenames: ReadonlySet<string>,
): string {
  if (!usedFilenames.has(candidate.toLowerCase())) {
    return candidate;
  }

  const dotIndex = candidate.lastIndexOf(".");
  const stem = dotIndex > 0 ? candidate.slice(0, dotIndex) : candidate;
  const ext = dotIndex > 0 ? candidate.slice(dotIndex) : "";

  for (const suffix of Array.from({ length: 99 }, (_, idx) => idx + 2)) {
    const next = `${stem} (${suffix})${ext}`;

    if (!usedFilenames.has(next.toLowerCase())) {
      return next;
    }
  }

  return candidate;
}

function uniqueDocumentFilename(
  candidate: string,
  usedFilenames: Set<string>,
): string {
  const chosen = peekUniqueDocumentFilename(candidate, usedFilenames);

  usedFilenames.add(chosen.toLowerCase());

  return chosen;
}

function fileAssetFallbackStem(
  kind: TopicFileAsset["kind"],
  index: number,
): string {
  if (kind === "image") return `Image ${index + 1}`;

  if (kind === "pptx") {
    return index ? `Presentation ${index + 1}` : "Presentation";
  }

  if (kind === "xlsx" || kind === "csv") {
    return index ? `Spreadsheet ${index + 1}` : "Spreadsheet";
  }

  return index ? `Document ${index + 1}` : "Document";
}

async function runOptionalDocumentStep(
  label: string,
  context: DocumentBatchContext,
  task: () => Promise<void>,
  onFailure?: () => void,
): Promise<number> {
  throwIfAborted(context.signal);

  try {
    await task();
    throwIfAborted(context.signal);
    context.onStepDone?.();

    return 1;
  } catch (error) {
    if (isAbortError(error)) throw error;
    onFailure?.();
    console.error(`OPFS Media Packager document (${label})`, error);
    context.warnings.push(label);
    context.onStepDone?.();

    return 0;
  }
}

function relativeFolderLabel(
  savedFolderPath: readonly string[],
  currentFolderPath: readonly string[],
): string | undefined {
  if (savedFolderPath.join("/") === currentFolderPath.join("/")) {
    return undefined;
  }

  return savedFolderPath.join(" / ") || undefined;
}

function recordDocumentOutcome(
  context: DocumentBatchContext,
  keys: { readonly primaryKey: string; readonly fallbackKey: string },
  record: DownloadedDocumentRecord,
): void {
  context.downloadedDocumentsByKey.set(keys.primaryKey, record);

  if (keys.fallbackKey && keys.fallbackKey !== keys.primaryKey) {
    context.downloadedDocumentsByKey.set(keys.fallbackKey, record);
  }
}

function recordSavedDocument(
  url: string,
  kind: DownloadedDocumentRecord["kind"],
  fallbackUrl: string | undefined,
  savedFilename: string,
  keys: { readonly primaryKey: string; readonly fallbackKey: string },
  context: DocumentBatchContext,
): void {
  recordDocumentOutcome(context, keys, {
    url,
    canonicalKey: keys.primaryKey,
    kind,
    filename: savedFilename,
    folderPath: [...context.currentFolderPath],
    status: "downloaded",
  });

  context.topicArtifacts.push({
    kind,
    url,
    ...(fallbackUrl ? { fallbackUrl } : {}),
    filename: savedFilename,
  });
}

function recordFailedDocument(
  url: string,
  kind: DownloadedDocumentRecord["kind"],
  keys: { readonly primaryKey: string; readonly fallbackKey: string },
  context: DocumentBatchContext,
): void {
  recordDocumentOutcome(context, keys, {
    url,
    canonicalKey: keys.primaryKey,
    kind,
    filename: "",
    folderPath: [...context.currentFolderPath],
    status: "failed",
  });
}

function tryReuseDownloadedDocument(
  url: string,
  kind: DownloadedDocumentRecord["kind"],
  fallbackUrl: string | undefined,
  context: DocumentBatchContext,
): {
  readonly primaryKey: string;
  readonly fallbackKey: string;
  readonly reused: boolean;
} {
  const primaryKey = canonicalDocumentUrlKey(url, kind);

  const fallbackKey = fallbackUrl
    ? canonicalDocumentUrlKey(fallbackUrl, kind)
    : "";

  const existing =
    context.downloadedDocumentsByKey.get(primaryKey) ??
    (fallbackKey
      ? context.downloadedDocumentsByKey.get(fallbackKey)
      : undefined) ??
    null;

  if (!existing) {
    return { primaryKey, fallbackKey, reused: false };
  }

  if (existing.status === "downloaded") {
    const folderLabel = relativeFolderLabel(
      existing.folderPath,
      context.currentFolderPath,
    );

    context.topicArtifacts.push({
      kind,
      url,
      ...(fallbackUrl ? { fallbackUrl } : {}),
      filename: existing.filename,
      alreadyDownloaded: true,
      ...(folderLabel ? { folderLabel } : {}),
    });
  }

  context.onStepDone?.();

  return { primaryKey, fallbackKey, reused: true };
}

async function waitForHiddenFrameLoad(
  frame: HTMLIFrameElement,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const state = { done: false };

    const cleanup = (): void => {
      clearTimeout(timer);
      frame.removeEventListener("load", onLoad);
      signal.removeEventListener("abort", onAbort);
    };

    const finishResolve = (): void => {
      if (state.done) return;
      state.done = true;
      cleanup();
      resolve();
    };

    const onLoad = (): void => finishResolve();

    const onAbort = (): void => {
      if (state.done) return;
      state.done = true;
      cleanup();
      reject(new DOMException("Download cancelled", "AbortError"));
    };

    const timer = setTimeout(finishResolve, 15000);

    frame.addEventListener("load", onLoad, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function slidesStartUrl(safeUrl: string): string {
  const parsed = new URL(safeUrl);
  const slideParam = parsed.searchParams.get("slide");

  if (slideParam !== null && /^\d+$/.test(slideParam)) {
    parsed.searchParams.delete("slide");
  }

  return parsed.href;
}

async function exportViaHiddenFrame<T>(options: {
  readonly url: string;
  readonly framePrefix: string;
  readonly messageType: "export-diagram-svg" | "export-slides-pdf";
  readonly width: number;
  readonly height: number;
  readonly signal: AbortSignal;
}): Promise<T | undefined> {
  const safeUrl = safeMediaUrl(options.url);

  if (!safeUrl) throw new Error("Unsafe export target URL.");

  const frameToken = `${options.framePrefix}${crypto.randomUUID()}`;
  const frame = document.createElement("iframe");

  frame.name = frameToken;
  frame.src = safeUrl;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;

  frame.style.cssText = `position:fixed;left:-10000px;top:-10000px;width:${options.width}px;height:${options.height}px;opacity:0;pointer-events:none;border:0;`;

  document.body.append(frame);

  try {
    await waitForHiddenFrameLoad(frame, options.signal);

    return (await chrome.runtime.sendMessage({
      type: options.messageType,
      url: safeUrl,
      frameToken,
    })) as T | undefined;
  } finally {
    frame.remove();
  }
}

function existingDocumentFilenameOnDisk(
  asset: TopicFileAsset,
  topicTitle: string,
  fallbackStem: string,
  usedFilenames: ReadonlySet<string>,
): string | null {
  const existingDownloads = appState.trackExistingDownloads;

  if (!existingDownloads?.size) return null;

  if (asset.kind === "pdf") {
    const pdfCandidate = peekUniqueDocumentFilename(
      prefixedDocumentFilename(topicTitle, asset.filename, "pdf", fallbackStem),
      usedFilenames,
    );

    return isAlreadyDownloadedFile(pdfCandidate) ? pdfCandidate : null;
  }

  if (asset.kind !== "image") {
    const fileExt = inferGenericFileExtension(
      asset.filename,
      asset.contentType || "",
    );

    const fileCandidate = peekUniqueDocumentFilename(
      prefixedDocumentFilename(
        topicTitle,
        asset.filename,
        fileExt,
        fallbackStem,
      ),
      usedFilenames,
    );

    return isAlreadyDownloadedFile(fileCandidate) ? fileCandidate : null;
  }

  const explicitMatch = /\.(png|jpe?g|webp|gif|svg|avif)$/i.exec(
    asset.filename.trim(),
  );

  const normalizedExplicit = explicitMatch
    ? explicitMatch[1].toLowerCase().replace("jpeg", "jpg")
    : "";

  const extensions = normalizedExplicit
    ? [
        normalizedExplicit,
        ...COMMON_IMAGE_EXTENSIONS.filter((ext) => ext !== normalizedExplicit),
      ]
    : COMMON_IMAGE_EXTENSIONS;

  return findExistingFilenameByExtensions(
    existingDownloads,
    currentDownloadSubfolder(),
    (ext) =>
      peekUniqueDocumentFilename(
        prefixedDocumentFilename(topicTitle, asset.filename, ext, fallbackStem),
        usedFilenames,
      ),
    extensions,
  );
}

async function downloadDocumentFiles(
  assets: readonly TopicFileAsset[],
  context: DocumentBatchContext,
): Promise<number> {
  const counter = { saved: 0 };

  for (const [index, asset] of assets.entries()) {
    throwIfAborted(context.signal);
    const fallbackStem = fileAssetFallbackStem(asset.kind, index);

    const lookup = tryReuseDownloadedDocument(
      asset.url,
      asset.kind,
      asset.fallbackUrl,
      context,
    );

    if (lookup.reused) continue;

    const existingOnDisk = existingDocumentFilenameOnDisk(
      asset,
      context.topicTitle,
      fallbackStem,
      context.usedFilenames,
    );

    if (existingOnDisk) {
      context.usedFilenames.add(existingOnDisk.toLowerCase());

      recordSavedDocument(
        asset.url,
        asset.kind,
        asset.fallbackUrl,
        existingOnDisk,
        lookup,
        context,
      );

      context.onStepDone?.();
      continue;
    }

    counter.saved += await runOptionalDocumentStep(
      asset.filename || fallbackStem,
      context,
      async () => {
        const { bytes, contentType } = await fetchDocumentFile(
          asset,
          context.signal,
        );

        const { extension, mimeType } = resolvedFileAssetFormat(
          asset.kind,
          asset.filename,
          contentType,
        );

        const targetName = uniqueDocumentFilename(
          prefixedDocumentFilename(
            context.topicTitle,
            asset.filename,
            extension,
            fallbackStem,
          ),
          context.usedFilenames,
        );

        if (!isAlreadyDownloadedFile(targetName)) {
          await saveBrowserDownload(bytes, targetName, mimeType);
        }

        recordSavedDocument(
          asset.url,
          asset.kind,
          asset.fallbackUrl,
          targetName,
          lookup,
          context,
        );
      },
      () => recordFailedDocument(asset.url, asset.kind, lookup, context),
    );
  }

  return counter.saved;
}

async function exportLinkPayload(
  link: TopicLinkAsset,
  signal: AbortSignal,
): Promise<{
  readonly contents: Uint8Array | string;
  readonly extension: string;
  readonly mime: string;
}> {
  if (link.kind === "diagram") {
    const res = await exportViaHiddenFrame<ExportDiagramResponse>({
      url: link.url,
      framePrefix: "opfs-media-packager-diagram-frame:",
      messageType: "export-diagram-svg",
      width: 1280,
      height: 800,
      signal,
    });

    if (!res?.svg || res.ok === false) {
      throw new Error(res?.error || "Could not export Excalidraw diagram.");
    }

    return Object.freeze({
      contents: res.svg,
      extension: "svg",
      mime: "image/svg+xml",
    });
  }

  const safeSlidesUrl = safeMediaUrl(link.url);

  if (!safeSlidesUrl) throw new Error("Unsafe slides URL.");

  const res = await exportViaHiddenFrame<ExportSlidesResponse>({
    url: slidesStartUrl(safeSlidesUrl),
    framePrefix: "opfs-media-packager-slides-frame:",
    messageType: "export-slides-pdf",
    width: 1440,
    height: 810,
    signal,
  });

  if (!res?.pdfBase64 || res.ok === false) {
    throw new Error(res?.error || "Could not export slide deck.");
  }

  const pdfBytes = bytesFromBase64(res.pdfBase64);

  if (!pdfBytes.byteLength) throw new Error("Empty slide deck PDF.");

  return Object.freeze({
    contents: pdfBytes,
    extension: "pdf",
    mime: "application/pdf",
  });
}

async function downloadDocumentLinks(
  links: readonly TopicLinkAsset[],
  context: DocumentBatchContext,
): Promise<number> {
  const counter = { saved: 0 };

  for (const [index, link] of links.entries()) {
    throwIfAborted(context.signal);
    const labelPrefix = link.kind === "diagram" ? "Diagram" : "Slides";
    const fallbackStem = `${labelPrefix} ${index + 1}`;
    const ext = link.kind === "diagram" ? "svg" : "pdf";

    const lookup = tryReuseDownloadedDocument(
      link.url,
      link.kind,
      undefined,
      context,
    );

    if (lookup.reused) continue;

    const plannedName = peekUniqueDocumentFilename(
      prefixedDocumentFilename(
        context.topicTitle,
        link.title,
        ext,
        fallbackStem,
      ),
      context.usedFilenames,
    );

    if (isAlreadyDownloadedFile(plannedName)) {
      context.usedFilenames.add(plannedName.toLowerCase());

      recordSavedDocument(
        link.url,
        link.kind,
        undefined,
        plannedName,
        lookup,
        context,
      );

      context.onStepDone?.();
      continue;
    }

    counter.saved += await runOptionalDocumentStep(
      link.title || fallbackStem,
      context,
      async () => {
        const exported = await exportLinkPayload(link, context.signal);

        throwIfAborted(context.signal);

        const targetName = uniqueDocumentFilename(
          prefixedDocumentFilename(
            context.topicTitle,
            link.title,
            exported.extension,
            fallbackStem,
          ),
          context.usedFilenames,
        );

        await saveBrowserDownload(exported.contents, targetName, exported.mime);

        recordSavedDocument(
          link.url,
          link.kind,
          undefined,
          targetName,
          lookup,
          context,
        );
      },
      () => recordFailedDocument(link.url, link.kind, lookup, context),
    );
  }

  return counter.saved;
}

async function downloadDocumentNotes(
  notes: readonly TopicMarkdownNote[],
  context: DocumentBatchContext,
  baseArtifacts: readonly DownloadedArtifactAnnotation[],
): Promise<number> {
  const counter = { saved: 0 };

  for (const [index, note] of notes.entries()) {
    throwIfAborted(context.signal);
    const noteUrl = note.sourceUrl?.trim() || "";
    const noteLabel = note.title || `Note ${index + 1}`;

    const lookup = noteUrl
      ? tryReuseDownloadedDocument(noteUrl, "note", undefined, context)
      : null;

    if (lookup?.reused) continue;

    const repairedNote = cleanTopicMarkdown(
      repairDoubleEncodedUtf8(note.markdown),
    );

    if (!repairedNote.trim()) continue;

    const plannedName = peekUniqueDocumentFilename(
      prefixedDocumentFilename(
        context.topicTitle,
        note.title,
        "md",
        `Note ${index + 1}`,
      ),
      context.usedFilenames,
    );

    if (isAlreadyDownloadedFile(plannedName)) {
      context.usedFilenames.add(plannedName.toLowerCase());

      if (noteUrl && lookup) {
        recordSavedDocument(
          noteUrl,
          "note",
          undefined,
          plannedName,
          lookup,
          context,
        );
      }

      context.onStepDone?.();
      continue;
    }

    const annotatedNote = annotateMarkdownWithDownloadedArtifacts(
      repairedNote,
      baseArtifacts,
      canonicalDocumentUrlKey,
    );

    counter.saved += await runOptionalDocumentStep(
      noteLabel,
      context,
      async () => {
        const targetName = uniqueDocumentFilename(
          prefixedDocumentFilename(
            context.topicTitle,
            note.title,
            "md",
            `Note ${index + 1}`,
          ),
          context.usedFilenames,
        );

        await saveBrowserDownload(
          annotatedNote,
          targetName,
          "text/markdown;charset=utf-8",
        );

        if (noteUrl && lookup) {
          recordSavedDocument(
            noteUrl,
            "note",
            undefined,
            targetName,
            lookup,
            context,
          );
        }
      },
      lookup
        ? () => recordFailedDocument(noteUrl, "note", lookup, context)
        : undefined,
    );
  }

  return counter.saved;
}

async function saveMainTopicMarkdown(
  topicTitle: string,
  markdown: string,
  context: DocumentBatchContext,
): Promise<number> {
  const repairedMarkdown = cleanTopicMarkdown(
    repairDoubleEncodedUtf8(markdown),
  );

  if (!repairedMarkdown.trim()) return 0;

  const plannedNoteName = peekUniqueDocumentFilename(
    prefixedDocumentFilename(topicTitle, topicTitle, "md"),
    context.usedFilenames,
  );

  if (isAlreadyDownloadedFile(plannedNoteName)) {
    context.usedFilenames.add(plannedNoteName.toLowerCase());
    context.onStepDone?.();

    return 0;
  }

  const annotatedMarkdown = annotateMarkdownWithDownloadedArtifacts(
    repairedMarkdown,
    context.topicArtifacts,
    canonicalDocumentUrlKey,
  );

  return runOptionalDocumentStep("Page notes", context, async () => {
    const targetName = uniqueDocumentFilename(
      prefixedDocumentFilename(topicTitle, topicTitle, "md"),
      context.usedFilenames,
    );

    await saveBrowserDownload(
      annotatedMarkdown,
      targetName,
      "text/markdown;charset=utf-8",
    );
  });
}

async function downloadTopicCompanionDocuments(
  topicTitle: string,
  documents: TopicCompanionDocuments | undefined,
  signal: AbortSignal,
  options?: {
    readonly onStepDone?: () => void;
    readonly downloadedDocumentsByKey?: Map<string, DownloadedDocumentRecord>;
    readonly currentFolderPath?: readonly string[];
    readonly savedVideos?: readonly SavedTopicVideoArtifact[];
  },
): Promise<number> {
  if (!documents || !countTopicCompanionDocuments(documents)) return 0;

  const usedFilenames = new Set<string>();
  const warnings: string[] = [];

  const context: DocumentBatchContext = {
    topicTitle,
    signal,
    usedFilenames,
    downloadedDocumentsByKey:
      options?.downloadedDocumentsByKey ??
      new Map<string, DownloadedDocumentRecord>(),
    topicArtifacts: [],
    currentFolderPath: options?.currentFolderPath ?? [],
    warnings,
    onStepDone: options?.onStepDone,
  };

  const counts = { saved: 0 };

  for (const savedVideo of options?.savedVideos ?? []) {
    if (savedVideo.sourceUrl && savedVideo.filename) {
      context.topicArtifacts.push({
        kind: "video",
        url: savedVideo.sourceUrl,
        filename: savedVideo.filename,
      });
    }
  }

  counts.saved += await downloadDocumentFiles(documents.pdfs, context);
  counts.saved += await downloadDocumentFiles(documents.files ?? [], context);
  counts.saved += await downloadDocumentFiles(documents.images, context);
  counts.saved += await downloadDocumentLinks(documents.diagrams, context);
  counts.saved += await downloadDocumentLinks(documents.slides, context);

  const fileAndLinkArtifacts = context.topicArtifacts.filter(
    (artifact) => artifact.kind !== "video",
  );

  counts.saved += await downloadDocumentNotes(
    documents.extraNotes ?? [],
    context,
    fileAndLinkArtifacts,
  );

  counts.saved += await saveMainTopicMarkdown(
    topicTitle,
    documents.markdown,
    context,
  );

  if (warnings.length) {
    subtitleNote.hidden = false;

    subtitleNote.textContent = `Skipped ${warnings.length} unavailable document${warnings.length === 1 ? "" : "s"} (${warnings.slice(0, 3).join(", ")}).`;
  }

  return counts.saved;
}

async function runDocumentsDownloadPhase(
  item: TrackTopicDownload,
  documentsOnly: boolean,
  downloadedDocumentsByKey: Map<string, DownloadedDocumentRecord>,
  savedVideos: readonly SavedTopicVideoArtifact[] = [],
): Promise<{
  readonly outcome: "completed" | "cancelled";
  readonly savedCount: number;
}> {
  const controller = new AbortController();

  appState.controller = controller;
  setBusy(true, true);

  return withDownloadTabKeepAlive(async () => {
    try {
      const topicTitle = item.title || "Topic";

      if (documentsOnly) {
        const totalSteps = Math.max(
          countTopicCompanionDocuments(item.documents),
          1,
        );

        setStatus("Downloading companion documents…", topicTitle);
        progress.max = totalSteps;
        progress.value = 0;
      }

      const savedCount = await downloadTopicCompanionDocuments(
        topicTitle,
        item.documents,
        controller.signal,
        {
          downloadedDocumentsByKey,
          currentFolderPath: item.folderPath || [],
          savedVideos,
          ...(documentsOnly
            ? {
                onStepDone: () => {
                  progress.value = Math.min(progress.value + 1, progress.max);
                },
              }
            : {}),
        },
      );

      if (appState.trackDownloadCancelled || controller.signal.aborted) {
        return { outcome: "cancelled", savedCount: 0 };
      }

      if (documentsOnly) {
        progress.value = progress.max;

        setStatus(
          savedCount > 0
            ? "Companion documents finished"
            : "Companion documents already present",
          savedCount > 0
            ? `${savedCount} ${savedCount === 1 ? "file" : "files"} saved to Downloads / ${currentDownloadSubfolder()}.`
            : `All companion documents already exist in Downloads / ${currentDownloadSubfolder()}.`,
        );
      }

      return { outcome: "completed", savedCount };
    } catch (error) {
      if (appState.trackDownloadCancelled || isAbortError(error)) {
        setStatus(
          "Download cancelled",
          "Remaining companion documents were skipped.",
        );

        return { outcome: "cancelled", savedCount: 0 };
      }

      throw error;
    } finally {
      appState.controller = null;
      setBusy(false);
    }
  });
}

async function downloadStandaloneTrackSubtitle(
  item: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
): Promise<{
  readonly outcome: "completed" | "cancelled";
  readonly saved: boolean;
}> {
  if (trackDownload.subtitleDownloadPreference === "none") {
    return { outcome: "completed", saved: false };
  }

  const track = item.subtitles?.[0];

  if (!track?.url) return { outcome: "completed", saved: false };

  const topicTitle = item.title || "video";

  const targetName = subtitleFilename(videoFilename(topicTitle), track.url);

  if (isAlreadyDownloadedFile(targetName)) {
    return { outcome: "completed", saved: false };
  }

  const controller = new AbortController();

  appState.controller = controller;
  setBusy(true, true);

  return withDownloadTabKeepAlive(async () => {
    try {
      setStatus(
        "Downloading subtitle…",
        `${topicTitle} (${track.language || "Subtitle"})`,
      );

      const text = await subtitleText(track, controller.signal);

      if (appState.trackDownloadCancelled || controller.signal.aborted) {
        return { outcome: "cancelled", saved: false };
      }

      await saveBrowserDownload(text, targetName, "text/vtt;charset=utf-8");

      setStatus(
        "Subtitle finished",
        `${targetName} saved to Downloads / ${currentDownloadSubfolder()}.`,
      );

      return { outcome: "completed", saved: true };
    } catch (error) {
      if (appState.trackDownloadCancelled || isAbortError(error)) {
        setStatus("Download cancelled", "Remaining track topics were skipped.");

        return { outcome: "cancelled", saved: false };
      }

      throw error;
    } finally {
      appState.controller = null;
      setBusy(false);
    }
  });
}

async function runNonVideoTrackTopic(
  item: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
  mode: TrackDownloadMode,
  downloadedDocumentsByKey: Map<string, DownloadedDocumentRecord>,
): Promise<TrackTopicAttempt> {
  appState.trackFolderSegments = item.folderPath || [];
  appState.sourceTabId = trackDownload.sourceTabId ?? null;
  appState.sourcePageUrl = item.sourceUrl || "";
  videoTitle.textContent = item.title || "Companion documents";
  sourceHost.textContent = "Track topic";

  formatNote.textContent =
    "Subtitles, Markdown, images, PDFs, diagrams, and slides";

  subtitleNote.hidden = true;
  subtitleNote.textContent = "";

  const activity = { hadContent: false, downloadedAny: false };

  if (
    mode !== "documents" &&
    item.subtitles?.length &&
    trackDownload.subtitleDownloadPreference !== "none"
  ) {
    activity.hadContent = true;

    const subResult = await downloadStandaloneTrackSubtitle(
      item,
      trackDownload,
    );

    if (subResult.outcome === "cancelled" || appState.trackDownloadCancelled) {
      return Object.freeze({ status: "cancelled" });
    }

    if (subResult.saved) activity.downloadedAny = true;
  }

  if (mode !== "videos" && countTopicCompanionDocuments(item.documents) > 0) {
    activity.hadContent = true;

    const documentsResult = await runDocumentsDownloadPhase(
      item,
      true,
      downloadedDocumentsByKey,
    );

    if (
      documentsResult.outcome === "cancelled" ||
      appState.trackDownloadCancelled
    ) {
      return Object.freeze({ status: "cancelled" });
    }

    if (documentsResult.savedCount > 0) activity.downloadedAny = true;
  }

  await recordCompletedTrackTopic(item);

  return Object.freeze({
    status: "completed",
    skippedExisting: activity.hadContent && !activity.downloadedAny,
  });
}

function directVideoExtension(url: string): string {
  try {
    const match = /\.(mp4|m4v|webm|mov)$/i.exec(new URL(url).pathname);

    return match ? match[1].toLowerCase() : "mp4";
  } catch {
    return "mp4";
  }
}

function directVideoFilename(title: string, url: string): string {
  const stem = sanitizeFilenameStem(
    title.replace(/\.(mp4|m4v|webm|mov|mkv)$/i, ""),
  );

  return `${stem}.${directVideoExtension(url)}`;
}

async function downloadDirectSubtitleSidecar(
  track: KnownSubtitleTrack | null,
  savedFilename: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!track?.url) return false;

  const subName = subtitleFilename(savedFilename, track.url);

  if (isAlreadyDownloadedFile(subName)) return false;

  try {
    const text = await subtitleText(track, signal);

    await saveBrowserDownload(text, subName, "text/vtt;charset=utf-8");

    return true;
  } catch (subError) {
    if (appState.trackDownloadCancelled || isAbortError(subError)) {
      throw subError;
    }

    console.error("OPFS Media Packager subtitle download", subError);

    return false;
  }
}

async function downloadDirectTrackVideo(
  item: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
): Promise<{
  readonly outcome: "completed" | "cancelled";
  readonly savedFilename: string;
  readonly skipped: boolean;
}> {
  const safeUrl = safeMediaUrl(item.url || "");

  if (!safeUrl) throw new Error("Unsafe direct video URL.");

  const topicTitle = item.title || "video";
  const savedFilename = directVideoFilename(topicTitle, safeUrl);

  appState.trackFolderSegments = item.folderPath || [];
  appState.sourceTabId = trackDownload.sourceTabId ?? null;
  appState.sourcePageUrl = item.sourceUrl || "";

  const targetFilename = downloadRelativePath(
    currentDownloadSubfolder(),
    savedFilename,
  );

  const track =
    trackDownload.subtitleDownloadPreference === "none"
      ? null
      : item.subtitles?.[0] || null;

  videoTitle.textContent = topicTitle;
  sourceHost.textContent = "Direct video";
  filename.value = savedFilename;
  playlistUrl.value = safeUrl;
  subtitleNote.hidden = !track;

  subtitleNote.textContent = track
    ? `${track.language || "Subtitle"} is saved as a matching VTT file.`
    : "";

  const videoExistsOnDisk = isAlreadyDownloadedFile(savedFilename);
  const controller = new AbortController();

  appState.controller = controller;
  setBusy(true, true);

  return withDownloadTabKeepAlive(async () => {
    try {
      progress.max = 1;
      progress.value = 0;

      if (!videoExistsOnDisk) {
        setStatus("Downloading video…", savedFilename);

        await runRegisteredBrowserDownload(
          safeUrl,
          targetFilename,
          controller.signal,
        );

        recordDownloadedRelativePath(targetFilename);
      }

      if (appState.trackDownloadCancelled || controller.signal.aborted) {
        return Object.freeze({
          outcome: "cancelled" as const,
          savedFilename,
          skipped: false,
        });
      }

      const savedSub = await downloadDirectSubtitleSidecar(
        track,
        savedFilename,
        controller.signal,
      );

      progress.value = 1;

      setStatus(
        videoExistsOnDisk ? "Skipped existing video" : "Direct video finished",
        videoExistsOnDisk
          ? `${savedFilename} already exists in Downloads / ${currentDownloadSubfolder()}.`
          : `${savedFilename} saved to Downloads / ${currentDownloadSubfolder()}.`,
      );

      return Object.freeze({
        outcome: "completed" as const,
        savedFilename,
        skipped: videoExistsOnDisk && !savedSub,
      });
    } catch (error) {
      if (appState.trackDownloadCancelled || isAbortError(error)) {
        setStatus("Download cancelled", "The video download was cancelled.");

        return Object.freeze({
          outcome: "cancelled" as const,
          savedFilename,
          skipped: false,
        });
      }

      throw error;
    } finally {
      appState.controller = null;
      setBusy(false);
    }
  });
}

async function downloadMissingTrackVideoSubtitle(
  videoEntry: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
  savedFilename: string,
): Promise<{
  readonly outcome: "completed" | "cancelled";
  readonly saved: boolean;
}> {
  if (trackDownload.subtitleDownloadPreference === "none") {
    return { outcome: "completed", saved: false };
  }

  const track = videoEntry.subtitles?.[0];

  if (!track?.url) return { outcome: "completed", saved: false };

  const subName = subtitleFilename(savedFilename, track.url);

  if (isAlreadyDownloadedFile(subName)) {
    return { outcome: "completed", saved: false };
  }

  const controller = new AbortController();

  appState.controller = controller;
  setBusy(true, true);

  return withDownloadTabKeepAlive(async () => {
    try {
      const contents = await subtitleText(track, controller.signal);

      if (appState.trackDownloadCancelled || controller.signal.aborted) {
        return { outcome: "cancelled", saved: false };
      }

      await saveBrowserDownload(contents, subName, "text/vtt;charset=utf-8");

      return { outcome: "completed", saved: true };
    } catch (error) {
      if (appState.trackDownloadCancelled || isAbortError(error)) {
        return { outcome: "cancelled", saved: false };
      }

      console.error("OPFS Media Packager subtitle download", error);

      return { outcome: "completed", saved: false };
    } finally {
      appState.controller = null;
      setBusy(false);
    }
  });
}

async function runHlsTrackVideo(
  videoEntry: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
): Promise<{
  readonly outcome: "completed" | "cancelled";
  readonly savedFilename: string;
  readonly skipped: boolean;
}> {
  appState.trackFolderSegments = videoEntry.folderPath || [];
  appState.sourceTabId = trackDownload.sourceTabId ?? null;
  appState.sourcePageUrl = videoEntry.sourceUrl || "";

  const plannedOutputFormat = outputFormatOrDefault(
    trackDownload.outputFormat || container.value,
  );

  const plannedFilename = mediaFilename(
    videoEntry.title || "video",
    plannedOutputFormat,
  );

  if (isAlreadyDownloadedFile(plannedFilename)) {
    setStatus(
      "Skipping existing video…",
      `${plannedFilename} already exists in Downloads / ${currentDownloadSubfolder()}.`,
    );

    const subResult =
      plannedOutputFormat === "mp4"
        ? await downloadMissingTrackVideoSubtitle(
            videoEntry,
            trackDownload,
            plannedFilename,
          )
        : { outcome: "completed" as const, saved: false };

    if (subResult.outcome === "cancelled" || appState.trackDownloadCancelled) {
      return Object.freeze({
        outcome: "cancelled" as const,
        savedFilename: plannedFilename,
        skipped: false,
      });
    }

    return Object.freeze({
      outcome: "completed" as const,
      savedFilename: plannedFilename,
      skipped: !subResult.saved,
    });
  }

  await prepareTrackTopic(videoEntry, trackDownload);

  const savedFilename = mediaFilename(
    filename.value,
    outputFormatOrDefault(container.value),
  );

  const outcome = await startDownload();

  return Object.freeze({ outcome, savedFilename, skipped: false });
}

function topicVideoEntries(
  item: TrackTopicDownload,
): readonly TrackTopicDownload[] {
  const primaryTitle = item.primaryVideoTitle || item.title;

  return [
    { ...item, title: primaryTitle },
    ...(item.extraVideos || []).map((extra) => ({
      topicIndex: item.topicIndex,
      url: extra.url,
      title: extra.title,
      sourceUrl: extra.sourceUrl || item.sourceUrl,
      ...(extra.kind ? { kind: extra.kind } : {}),
      folderPath: item.folderPath,
      qualityOptions: extra.qualityOptions,
      subtitles: extra.subtitles,
    })),
  ];
}

async function runTrackTopicVideos(
  item: TrackTopicDownload,
  initialPlan: TrackDownloadPlan,
  savedVideos: SavedTopicVideoArtifact[],
  activity: { hadContent: boolean; downloadedAny: boolean },
): Promise<boolean> {
  for (const videoEntry of topicVideoEntries(item)) {
    activity.hadContent = true;
    const currentPlan = appState.activeTrackDownload ?? initialPlan;

    const isDirect =
      videoEntry.kind === "direct" || isDirectVideoUrl(videoEntry.url || "");

    const { outcome, savedFilename, skipped } = isDirect
      ? await downloadDirectTrackVideo(videoEntry, currentPlan)
      : await runHlsTrackVideo(videoEntry, currentPlan);

    if (outcome === "cancelled" || appState.trackDownloadCancelled) {
      return false;
    }

    if (!skipped) activity.downloadedAny = true;

    if (videoEntry.sourceUrl) {
      savedVideos.push({
        sourceUrl: videoEntry.sourceUrl,
        filename: savedFilename,
      });
    }
  }

  return true;
}

async function runSingleTrackTopic(
  item: TrackTopicDownload,
  trackDownload: TrackDownloadPlan,
  downloadedDocumentsByKey: Map<string, DownloadedDocumentRecord>,
): Promise<TrackTopicAttempt> {
  try {
    const activePlan = appState.activeTrackDownload ?? trackDownload;
    const mode = trackDownloadModeOrDefault(activePlan.trackDownloadMode);

    const videoAvailable =
      Boolean(item.url?.trim()) || Boolean(item.qualityOptions?.length);

    if (mode === "documents" || !videoAvailable) {
      return await runNonVideoTrackTopic(
        item,
        activePlan,
        mode,
        downloadedDocumentsByKey,
      );
    }

    const savedVideos: SavedTopicVideoArtifact[] = [];
    const activity = { hadContent: false, downloadedAny: false };

    const videosOk = await runTrackTopicVideos(
      item,
      activePlan,
      savedVideos,
      activity,
    );

    if (!videosOk) return Object.freeze({ status: "cancelled" });

    const planAfterVideos = appState.activeTrackDownload ?? activePlan;

    const latestMode = trackDownloadModeOrDefault(
      planAfterVideos.trackDownloadMode,
    );

    if (
      latestMode === "all" &&
      countTopicCompanionDocuments(item.documents) > 0
    ) {
      activity.hadContent = true;

      const documentResult = await runDocumentsDownloadPhase(
        item,
        false,
        downloadedDocumentsByKey,
        savedVideos,
      );

      if (
        documentResult.outcome === "cancelled" ||
        appState.trackDownloadCancelled
      ) {
        return Object.freeze({ status: "cancelled" });
      }

      if (documentResult.savedCount > 0) activity.downloadedAny = true;
    }

    await recordCompletedTrackTopic(item);

    return Object.freeze({
      status: "completed",
      skippedExisting: activity.hadContent && !activity.downloadedAny,
    });
  } catch (error) {
    if (appState.trackDownloadCancelled || isAbortError(error)) {
      return Object.freeze({ status: "cancelled" });
    }

    console.error("OPFS Media Packager track topic", error);
    const errorText = errorMessageOf(error);

    return Object.freeze({
      status: "failed",
      kind: classifyTrackTopicFailure(errorText),
      message: errorText,
    });
  }
}

function completedTrackDetails(
  totalTopics: number,
  topicWord: string,
  mode: TrackDownloadMode,
  runStats: { readonly downloaded: number; readonly skippedExisting: number },
): string {
  if (runStats.skippedExisting > 0 && runStats.downloaded === 0) {
    return `All ${totalTopics} ${topicWord} already existed in the selected track folders.`;
  }

  if (runStats.skippedExisting > 0) {
    return `${runStats.downloaded} downloaded, ${runStats.skippedExisting} already existed in the selected track folders.`;
  }

  if (mode === "documents") {
    return `Companion documents from ${totalTopics} ${topicWord} saved in the selected track folders.`;
  }

  if (mode === "all") {
    return `${totalTopics} ${topicWord} saved in the selected track folders.`;
  }

  return `${totalTopics} videos saved in the selected track folders.`;
}

function finalizeTrackQueueStatus(
  totalTopics: number,
  failures: readonly string[],
  haltedKind: TrackTopicFailureKind | null,
  mode: TrackDownloadMode = DEFAULT_DOWNLOAD_PREFERENCES.trackDownloadMode,
  runStats: {
    readonly downloaded: number;
    readonly skippedExisting: number;
  } = {
    downloaded: totalTopics,
    skippedExisting: 0,
  },
): void {
  const documentsOnly = mode === "documents";
  const scope = documentsOnly ? "Track documents" : "Track download";
  const topicWord = totalTopics === 1 ? "topic" : "topics";

  if (appState.trackDownloadCancelled) {
    const target = documentsOnly ? "companion documents" : "topics";

    setStatus(
      `${scope} cancelled`,
      `Completed ${target} remain in their track folders.`,
    );

    trackDownloadNote.textContent = `${scope} queue cancelled. Adjust settings and click Resume track to continue.`;

    return;
  }

  if (haltedKind === "rate-limited") {
    setStatus(
      "Track download paused — rate limit reached",
      "The media server temporarily rate-limited requests. Completed topics were kept; reload this tab or click Resume track after a few minutes.",
    );

    trackDownloadNote.textContent =
      "Track queue paused on HTTP 429/503; completed topics were kept.";

    return;
  }

  if (haltedKind === "unauthorized") {
    setStatus(
      "Track download paused: access denied",
      "Sign in again and refresh the source page, then select Resume track. Completed topics are kept.",
    );

    trackDownloadNote.textContent =
      "The server denied access to two topics. Refresh your session before resuming.";

    return;
  }

  if (failures.length) {
    const failedWord = failures.length === 1 ? "topic" : "topics";
    const unit = documentsOnly ? "topics had documents" : "videos were";

    setStatus(
      `${scope} finished with errors`,
      `${totalTopics - failures.length} of ${totalTopics} ${unit} saved. Refresh the affected page or click Resume track to retry.`,
    );

    trackDownloadNote.textContent = `${failures.length} ${failedWord} failed; completed topics were kept.`;

    return;
  }

  const completedDetails = completedTrackDetails(
    totalTopics,
    topicWord,
    mode,
    runStats,
  );

  setStatus(`${scope} finished`, completedDetails);

  if (runStats.skippedExisting > 0 && runStats.downloaded === 0) {
    trackDownloadNote.textContent = `${totalTopics} ${topicWord} already downloaded (skipped).`;

    return;
  }

  if (runStats.skippedExisting > 0) {
    trackDownloadNote.textContent = `${runStats.downloaded} saved · ${runStats.skippedExisting} skipped (already present).`;

    return;
  }

  trackDownloadNote.textContent = `${totalTopics} ${topicWord} saved.`;
}

function emptyTrackErrorMessage(mode: TrackDownloadMode): string {
  if (mode === "documents") {
    return "This track scan did not find any downloadable companion documents.";
  }

  if (mode === "videos") {
    return "This track scan did not find any downloadable videos.";
  }

  return "This track scan did not find any downloadable videos, subtitles, or companion documents.";
}

async function processTrackQueueTopic(
  context: TrackQueueTopicContext,
): Promise<boolean> {
  const {
    index,
    item,
    totalTopics,
    initialPlan,
    queueState,
    runStats,
    failures,
  } = context;

  if (isTopicAlreadyCompleted(item, appState.trackCompletedIndices)) {
    return true;
  }

  const activePlan = appState.activeTrackDownload ?? initialPlan;

  const activeMode = trackDownloadModeOrDefault(activePlan.trackDownloadMode);

  trackDownloadNote.textContent =
    activeMode === "documents"
      ? `Track documents ${index + 1} of ${totalTopics}: ${item.title}`
      : `Track download ${index + 1} of ${totalTopics}: ${item.title}`;

  const attempt = await runSingleTrackTopic(
    item,
    activePlan,
    appState.trackDownloadedDocumentsByKey,
  );

  if (attempt.status === "cancelled") {
    appState.trackDownloadCancelled = true;

    return false;
  }

  if (attempt.status === "completed") {
    queueState.consecutiveAuthFailures = 0;

    if (attempt.skippedExisting) {
      runStats.skippedExisting += 1;

      return true;
    }

    runStats.downloaded += 1;

    return true;
  }

  failures.push(item.title || `Topic ${index + 1}`);

  return !shouldHaltTrackQueue(attempt.kind, queueState);
}

/** Downloads the selected track topics in their displayed order. */
async function runTrackDownloads(
  trackDownload: TrackDownloadPlan,
): Promise<void> {
  const initialPlan = appState.activeTrackDownload ?? trackDownload;
  const mode = trackDownloadModeOrDefault(initialPlan.trackDownloadMode);
  const items = initialPlan.items || [];

  if (!items.length) {
    throw new Error(emptyTrackErrorMessage(mode));
  }

  appState.activeTrackDownload = initialPlan;
  appState.trackRunActive = true;
  appState.trackDownloadCancelled = false;

  for (const idx of initialPlan.completedTopicIndices || []) {
    appState.trackCompletedIndices.add(idx);
  }

  updateDownloadButtonLabel();
  trackDownloadNote.hidden = false;
  const failures: string[] = [];
  const runStats = { downloaded: 0, skippedExisting: 0 };

  const queueState: TrackQueueState = {
    consecutiveAuthFailures: 0,
    haltedKind: null,
  };

  appState.trackExistingDownloads = await loadExistingDownloadsIndex();

  try {
    await withDownloadTabKeepAlive(async () => {
      for (const [index, item] of items.entries()) {
        if (appState.trackDownloadCancelled) break;

        const shouldContinue = await processTrackQueueTopic({
          index,
          item,
          totalTopics: items.length,
          initialPlan,
          queueState,
          runStats,
          failures,
        });

        if (!shouldContinue) break;
      }
    });
  } finally {
    appState.trackRunActive = false;
    appState.trackFolderSegments = [];
    appState.trackExistingDownloads = null;

    const allCompleted =
      !appState.trackDownloadCancelled &&
      !queueState.haltedKind &&
      !failures.length &&
      !hasResumableTrackPlan();

    if (allCompleted) appState.activeTrackDownload = null;
    setBusy(false);
  }

  finalizeTrackQueueStatus(
    items.length,
    failures,
    queueState.haltedKind,
    mode,
    runStats,
  );
}

analyzeButton.addEventListener("click", () => {
  analyze().catch((error) => setFailure("Could not analyze playlist", error));
});

downloadButton.addEventListener("click", () => {
  if (
    hasResumableTrackPlan() &&
    appState.activeTrackDownload &&
    !appState.trackRunActive
  ) {
    syncTrackPreferencesFromControls();

    runTrackDownloads(appState.activeTrackDownload).catch((error) =>
      setFailure("Track download failed", error),
    );

    return;
  }

  startDownload().catch((error) => setFailure("Download failed", error));
});

cancelButton.addEventListener("click", () => {
  appState.trackDownloadCancelled = true;
  appState.controller?.abort();
});

saveDownloadSubfolderButton.addEventListener("click", () => {
  saveDownloadSubfolder().catch((error) =>
    setFailure("Could not save download subfolder", error),
  );
});

copyPlaylistButton.addEventListener("click", () => {
  copyPlaylistUrl().catch((error) =>
    setFailure("Could not copy manifest link", error),
  );
});

playlistUrl.addEventListener("input", () => {
  appState.playlistAnalysis = null;
  appState.activeTrackDownload = null;
  appState.trackCompletedIndices = new Set<number>();
  appState.userSelectedQualityForUrl = "";
  qualitySelect.disabled = true;
  qualitySelect.replaceChildren(new Option("Analyze the manifest first"));
  downloadButton.disabled = true;
  updateDownloadButtonLabel();
});

concurrency.addEventListener("change", () => {
  chrome.storage.local.set({ segmentConcurrency: Number(concurrency.value) });
  syncTrackPreferencesFromControls();
});

container.addEventListener("change", () => {
  const nextFormat = outputFormatOrDefault(container.value);

  filename.value = mediaFilename(filename.value, nextFormat);
  chrome.storage.local.set({ preferredOutput: container.value });
  updateOutputNote();

  if (appState.selectedSubtitleTrack) {
    subtitleNote.hidden = false;
    subtitleNote.textContent = `${appState.selectedSubtitleTrack.language} is ${nextFormat === "mkv" ? "embedded in the MKV" : "saved as a matching VTT file"}.`;
  }

  syncTrackPreferencesFromControls();
});

qualitySelect.addEventListener("change", () => {
  const selected =
    appState.playlistAnalysis?.qualityOptions[Number(qualitySelect.value)];

  if (selected) {
    appState.selectedQualityPlaylistUrl = selected.uri;
    appState.userSelectedQualityForUrl = playlistUrl.value.trim();
    chrome.storage.local.set({ preferredQualityLabel: selected.label });
    syncTrackPreferencesFromControls();
  }
});

const preferencesReady = chrome.storage.local
  .get({
    segmentConcurrency: DEFAULT_SEGMENT_CONCURRENCY,
    preferredOutput: DEFAULT_OUTPUT_FORMAT,
  })
  .then(({ segmentConcurrency, preferredOutput }) => {
    concurrency.value = String(clampConcurrency(Number(segmentConcurrency)));
    container.value = outputFormatOrDefault(preferredOutput);
    updateOutputNote();
  });

chrome.storage.session.get(runStateKey).then((stored) => {
  const previous = stored[runStateKey] as ActiveDownloadJob | undefined;

  if (previous?.state === "running" || previous?.state === "interrupted") {
    setStatus(
      "Previous download was interrupted",
      `${previous.filename || "Video"} stopped after ${previous.completedSegments || 0} of ${previous.totalSegments || "?"} segments. Start it again from the video page.`,
    );
  }
});

window.addEventListener("error", (event) =>
  setFailure("Something interrupted this page", event.error || event.message),
);

window.addEventListener("unhandledrejection", (event) =>
  setFailure("Something interrupted this download", event.reason),
);

const downloadRequestId = new URLSearchParams(location.search).get(
  "download-request",
);

const trackDownloadId = new URLSearchParams(location.search).get("track");

if (downloadRequestId) {
  chrome.runtime
    .sendMessage({ type: "take-download-request", downloadRequestId })
    .then(
      async ({
        download: handoffDownload,
      }: {
        download?: HandoffDownloadRequest;
      }) => {
        if (!handoffDownload?.url) return;
        await Promise.all([preferencesReady, downloadSubfolderReady]);

        appState.selectedQualityPlaylistUrl =
          handoffDownload.selectedQualityUrl || null;

        appState.selectedSubtitleTrack = handoffDownload.subtitle || null;
        appState.singleDownloadDocuments = handoffDownload.documents || null;
        appState.sourceTabId = handoffDownload.sourceTabId ?? null;
        const autoStart = handoffDownload.autoStart === true;

        appState.autoStart = autoStart;
        appState.sourcePageUrl = handoffDownload.sourceUrl || "";
        videoTitle.textContent = handoffDownload.title || "Download your video";
        sourceHost.textContent = "Detected stream";
        filename.value = videoFilename(handoffDownload.title || "video");

        container.value = outputFormatOrDefault(
          handoffDownload.outputFormat || DEFAULT_OUTPUT_FORMAT,
        );

        updateOutputNote();

        if (appState.selectedSubtitleTrack) {
          subtitleNote.hidden = false;
          subtitleNote.textContent = `${appState.selectedSubtitleTrack.language || "Subtitle"} is selected.`;
        }

        playlistUrl.value = handoffDownload.url;

        try {
          if (handoffDownload.qualityOptions?.length) {
            applyQualityChoices(
              suppliedQualityChoices(handoffDownload.qualityOptions),
            );
          }

          if (!handoffDownload.qualityOptions?.length) {
            await analyze();
          }

          if (autoStart) await startDownload();
        } catch (error) {
          setFailure(
            autoStart
              ? "Download could not start"
              : "Could not analyze detected playlist",
            error,
          );
        }
      },
    );
}

if (trackDownloadId) {
  chrome.runtime
    .sendMessage({ type: "take-track-download", trackDownloadId })
    .then(async ({ trackDownload }: { trackDownload?: TrackDownloadPlan }) => {
      if (!trackDownload?.items?.length) {
        setStatus(
          "Track download unavailable",
          "Start a new track scan from the track page.",
        );

        return;
      }

      await Promise.all([preferencesReady, downloadSubfolderReady]);

      appState.activeTrackDownload = trackDownload;

      appState.trackCompletedIndices = new Set(
        trackDownload.completedTopicIndices || [],
      );

      appState.trackDownloadedDocumentsByKey = new Map();

      const mode = trackDownloadModeOrDefault(trackDownload.trackDownloadMode);

      videoTitle.textContent = trackDownload.title || "Track";
      trackDownloadNote.hidden = false;

      trackDownloadNote.textContent =
        mode === "documents"
          ? `${trackDownload.items.length} topics queued for documents download. Folder names follow the track outline.`
          : `${trackDownload.items.length} video topics are queued. Folder names follow the track outline.`;

      await runTrackDownloads(trackDownload);
    })
    .catch((error) => setFailure("Track download unavailable", error));
}
