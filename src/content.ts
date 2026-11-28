import {
  trackRootFolderName,
  normalizeTopicTitleKey,
  type TrackOutline,
  type UsableTrackTopic as TrackOutlineTopic,
} from "../lib/track/track-plan.ts";
import {
  activeStorageBlobUrl,
  countTopicCompanionDocuments,
  extractTopicCompanionDocumentsFromLinksAndHtml,
  isExcalidrawUrl,
  isSlidesDeckUrl,
  normalizeEmbeddedVideoUrl,
  type EmbeddedVideoLink,
  type TopicCompanionDocuments,
} from "../lib/materials/topic-assets.ts";
import { scoreLinkedVideoUrl } from "../lib/materials/linked-video.ts";
import { isDirectVideoUrl } from "../lib/media/stream-identity.ts";
import {
  isStoryboardSubtitleUrl,
  isSubtitleResourceUrl,
} from "../lib/subtitles/subtitle-tracks.ts";

interface PendingTrackProbe {
  readonly ackTimer: ReturnType<typeof setTimeout>;
  ackDone: boolean;
  readonly sendResponse: (response: unknown) => void;
}

interface PageSubtitleTrack {
  readonly url: string;
  readonly language: string;
  readonly label: string;
}

interface ButtonSidebarTopic {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly section: string;
  readonly navigationIndex: number;
}

interface SidebarTopicEntry {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly sectionKey: string;
  readonly sectionTitle: string;
  readonly navigationIndex?: number;
}

interface SidebarSectionAccumulator {
  readonly number: number;
  title: string;
  titled: boolean;
  count: number;
}

interface LinkedVideoCandidate {
  readonly url: string;
  readonly score: number;
  readonly title: string;
}

type LinkedVideoResult =
  | { readonly ok: false }
  | { readonly ok: true; readonly url: string; readonly title?: string }
  | { readonly ok: true; readonly clicked: true; readonly title: string };

interface SidebarClickResult {
  readonly ok: boolean;
  readonly alreadyActive?: boolean;
}

interface RuntimeMessage {
  readonly type?: unknown;
  readonly probeId?: unknown;
  readonly url?: unknown;
  readonly requestId?: unknown;
  readonly items?: unknown;
  readonly responseType?: unknown;
  readonly topicIndex?: unknown;
  readonly topicTitle?: unknown;
  readonly topicSection?: unknown;
}

interface WindowBridgeMessage {
  readonly source?: unknown;
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly response?: unknown;
  readonly topicIndex?: unknown;
  readonly stream?: unknown;
  readonly partial?: unknown;
  readonly unresolvedIndices?: unknown;
  readonly unresolvedLinks?: unknown;
  readonly unresolvedLinkLists?: unknown;
  readonly tracks?: unknown;
  readonly rateLimited?: unknown;
}

type RuntimeMessageHandler = (
  message: RuntimeMessage,
  sendResponse: (response: unknown) => void,
) => boolean;

// Detect subtitle tracks that the player declares in its DOM before the viewer
// opens the CC menu. This also runs inside player iframes.
const sentTracks = new Set<string>();

const contentState = {
  lastOutlineFingerprint: "",
  lastReportedPageUrl: "",
  resourceScanFloor: 0,
};

const pendingMediaFetches = new Set<string>();
const pendingTrackProbes = new Map<string, PendingTrackProbe>();
const hiddenProbeFrames = new Map<string, HTMLIFrameElement>();
const hiddenProbePrefix = "opfs-media-packager-probe:";
const hiddenOutlinePrefix = "opfs-media-packager-outline:";
const hiddenDiagramPrefix = "opfs-media-packager-diagram-frame:";
const hiddenSlidesPrefix = "opfs-media-packager-slides-frame:";

const OFFSCREEN_DESKTOP_STYLE =
  "position:fixed;width:1440px;height:900px;opacity:0;pointer-events:none;border:0;left:-9999px;top:-9999px;";

const currentHiddenProbeId =
  window.top !== window &&
  typeof window.name === "string" &&
  window.name.startsWith(hiddenProbePrefix)
    ? window.name.slice(hiddenProbePrefix.length)
    : "";

const currentHiddenOutlineId =
  window.top !== window &&
  typeof window.name === "string" &&
  window.name.startsWith(hiddenOutlinePrefix)
    ? window.name.slice(hiddenOutlinePrefix.length)
    : "";

const currentHiddenDiagramToken =
  window.top !== window &&
  typeof window.name === "string" &&
  window.name.startsWith(hiddenDiagramPrefix)
    ? window.name
    : "";

const currentHiddenSlidesToken =
  window.top !== window &&
  typeof window.name === "string" &&
  window.name.startsWith(hiddenSlidesPrefix)
    ? window.name
    : "";

const isHiddenHelperFrame = Boolean(
  currentHiddenProbeId ||
  currentHiddenOutlineId ||
  currentHiddenDiagramToken ||
  currentHiddenSlidesToken,
);

const offscreenOutlineState: {
  inFlight: Promise<TrackOutline | null> | null;
  cachedUrl: string;
  cachedOutline: TrackOutline | null;
  attemptedUrls: Set<string>;
} = {
  inFlight: null,
  cachedUrl: "",
  cachedOutline: null,
  attemptedUrls: new Set<string>(),
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function openHiddenProbeFrame(probeId: string, url: string): boolean {
  closeHiddenProbeFrame(probeId);
  const parsed = tryParseUrl(url);

  if (!parsed || parsed.origin !== location.origin) return false;
  const frame = document.createElement("iframe");

  frame.name = `${hiddenProbePrefix}${probeId}`;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText = OFFSCREEN_DESKTOP_STYLE;
  frame.src = parsed.href;
  (document.body || document.documentElement).append(frame);
  hiddenProbeFrames.set(probeId, frame);

  return true;
}

function navigateHiddenProbeFrame(probeId: string, url: string): boolean {
  const frame = hiddenProbeFrames.get(probeId);
  const parsed = tryParseUrl(url);

  if (!frame || !parsed || parsed.origin !== location.origin) return false;
  frame.src = parsed.href;

  return true;
}

function closeHiddenProbeFrame(probeId: string): void {
  const frame = hiddenProbeFrames.get(probeId);

  if (!frame) return;
  hiddenProbeFrames.delete(probeId);
  frame.remove();
}

function currentPageHeading(): string {
  return (
    cleanText(
      document.querySelector(
        '[data-circle="event-title"], main h1, [role=main] h1, main h2, [role=main] h2',
      )?.textContent || "",
    ) || cleanText(document.title.replace(/\s+[|·]\s+[^|·]{2,60}$/, ""))
  );
}

function handleProbeTrackTopicsMessage(
  message: RuntimeMessage,
  sendResponse: (response: unknown) => void,
): boolean {
  const requestId = message.requestId;

  if (typeof requestId !== "string" || !Array.isArray(message.items)) {
    return false;
  }

  const ackTimer = setTimeout(() => {
    if (!pendingTrackProbes.has(requestId)) return;
    pendingTrackProbes.delete(requestId);
    sendResponse({ ok: false, reason: "probe-not-ready" });
  }, 500);

  pendingTrackProbes.set(requestId, {
    ackTimer,
    ackDone: false,
    sendResponse,
  });

  window.postMessage(
    {
      source: "opfs-media-packager",
      type: "probe-track-topics",
      requestId,
      items: message.items,
    },
    location.origin,
  );

  return true;
}

function handleFetchMediaFromPageMessage(message: RuntimeMessage): boolean {
  if (
    typeof message.requestId !== "string" ||
    typeof message.url !== "string" ||
    typeof message.responseType !== "string" ||
    !["text", "bytes"].includes(message.responseType)
  ) {
    return false;
  }

  pendingMediaFetches.add(message.requestId);

  window.postMessage(
    {
      source: "opfs-media-packager",
      type: "fetch-media",
      requestId: message.requestId,
      responseType: message.responseType,
      url: message.url,
    },
    location.origin,
  );

  return false;
}

const runtimeMessageHandlers: Readonly<Record<string, RuntimeMessageHandler>> =
  Object.freeze({
    "open-hidden-probe-frame"(message, sendResponse) {
      if (
        typeof message.probeId !== "string" ||
        typeof message.url !== "string"
      ) {
        return false;
      }

      sendResponse({ ok: openHiddenProbeFrame(message.probeId, message.url) });

      return false;
    },
    "navigate-hidden-probe-frame"(message, sendResponse) {
      if (
        typeof message.probeId !== "string" ||
        typeof message.url !== "string"
      ) {
        return false;
      }

      sendResponse({
        ok: navigateHiddenProbeFrame(message.probeId, message.url),
      });

      return false;
    },
    "close-hidden-probe-frame"(message, sendResponse) {
      if (typeof message.probeId !== "string") return false;
      closeHiddenProbeFrame(message.probeId);
      sendResponse({ ok: true });

      return false;
    },
    "collect-track-outline"(_message, sendResponse) {
      if (expandSidebarSections()) {
        setTimeout(() => reportTrackOutline(true), 500);
      }

      reportTracks(true);

      Promise.resolve(reportTrackOutline(true)).finally(() =>
        sendResponse({ ok: true }),
      );

      return true;
    },
    "probe-track-topics": handleProbeTrackTopicsMessage,
    "find-linked-video-in-page"(_message, sendResponse) {
      sendResponse(findLinkedVideoInPage());

      return false;
    },
    "collect-page-subtitles"(_message, sendResponse) {
      sendResponse({ tracks: collectPageSubtitleTracks() });

      return false;
    },
    "extract-topic-documents"(_message, sendResponse) {
      sendResponse({ documents: extractTopicCompanionDocumentsFromDom() });

      return false;
    },
    "get-page-heading"(_message, sendResponse) {
      sendResponse({ title: currentPageHeading() });

      return false;
    },
    "navigate-track-sidebar"(message, sendResponse) {
      const topicIndex =
        typeof message.topicIndex === "number" ? message.topicIndex : undefined;

      const validIndex =
        typeof topicIndex === "number" &&
        Number.isInteger(topicIndex) &&
        topicIndex >= 0;

      const topicTitleText =
        typeof message.topicTitle === "string" ? message.topicTitle : "";

      const topicSectionText =
        typeof message.topicSection === "string" ? message.topicSection : "";

      if (!validIndex && typeof message.topicTitle !== "string") return false;

      clickSidebarTopic(topicIndex, topicTitleText, topicSectionText)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ ok: false }));

      return true;
    },
    "collect-direct-video"(_message, sendResponse) {
      sendResponse({ url: collectDomDirectVideoUrl() });

      return false;
    },
    "fetch-media-from-page": handleFetchMediaFromPageMessage,
  });

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, _sender, sendResponse) => {
    const message: RuntimeMessage | null = isObjectRecord(rawMessage)
      ? rawMessage
      : null;

    const handler =
      typeof message?.type === "string" &&
      Object.hasOwn(runtimeMessageHandlers, message.type)
        ? runtimeMessageHandlers[message.type]
        : null;

    return handler && message ? handler(message, sendResponse) : undefined;
  },
);

const windowMessageHandlers: Readonly<
  Record<string, (data: WindowBridgeMessage) => void>
> = Object.freeze({
  "fetch-media-result"(data) {
    if (
      typeof data.requestId !== "string" ||
      !pendingMediaFetches.delete(data.requestId)
    ) {
      return;
    }

    chrome.runtime
      .sendMessage({
        type: "page-media-result",
        requestId: data.requestId,
        response: data.response,
      })
      .catch(() => {});
  },
  "probe-track-topics-ack"(data) {
    if (typeof data.requestId !== "string") return;
    const pending = pendingTrackProbes.get(data.requestId);

    if (!pending || pending.ackDone) return;
    pending.ackDone = true;
    clearTimeout(pending.ackTimer);
    pending.sendResponse({ ok: true });
  },
  "track-topic-probed"(data) {
    if (
      typeof data.requestId !== "string" ||
      !pendingTrackProbes.has(data.requestId)
    ) {
      return;
    }

    chrome.runtime
      .sendMessage({
        type: "track-topic-probed",
        requestId: data.requestId,
        topicIndex: data.topicIndex,
        stream: data.stream || null,
        partial: data.partial === true,
      })
      .catch(() => {});
  },
  "track-topics-probe-done"(data) {
    if (
      typeof data.requestId !== "string" ||
      !pendingTrackProbes.delete(data.requestId)
    ) {
      return;
    }

    chrome.runtime
      .sendMessage({
        type: "track-topics-probe-done",
        requestId: data.requestId,
        unresolvedIndices: Array.isArray(data.unresolvedIndices)
          ? data.unresolvedIndices
          : [],
        unresolvedLinks:
          data.unresolvedLinks && typeof data.unresolvedLinks === "object"
            ? data.unresolvedLinks
            : {},
        unresolvedLinkLists:
          data.unresolvedLinkLists &&
          typeof data.unresolvedLinkLists === "object"
            ? data.unresolvedLinkLists
            : {},
        rateLimited: data.rateLimited === true,
      })
      .catch(() => {});
  },
  "track-stream"(data) {
    chrome.runtime
      .sendMessage({ type: "page-track-stream", stream: data.stream })
      .catch(() => {});
  },
  "page-subtitle-tracks"(data) {
    if (!Array.isArray(data.tracks) || !data.tracks.length) return;

    chrome.runtime
      .sendMessage({ type: "page-subtitle-tracks", tracks: data.tracks })
      .catch(() => {});
  },
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data: WindowBridgeMessage | null = isObjectRecord(event.data)
    ? event.data
    : null;

  if (
    event.source !== window ||
    event.origin !== location.origin ||
    data?.source !== "opfs-media-packager"
  ) {
    return;
  }

  const handler =
    typeof data.type === "string" &&
    Object.hasOwn(windowMessageHandlers, data.type)
      ? windowMessageHandlers[data.type]
      : null;

  if (handler) handler(data);
});

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function chapterTitle(chapter: Element): string {
  const heading = chapter.querySelector("h1, h2, h3, h4, [role=button]");

  return cleanText(heading?.textContent || "Section");
}

function topicUrl(item: Element, currentUrl: URL): string {
  const link =
    item.closest<HTMLAnchorElement>("a[href]") ||
    item.querySelector<HTMLAnchorElement>("a[href]");

  if (link?.href) return link.href;
  const match = /^list-content-(\d+)$/.exec(item.id);

  if (!match) return "";
  const url = new URL(currentUrl.href);

  const chapterId = /^chapter-(\d+)$/.exec(
    item.closest('[id^="chapter-"]')?.id || "",
  )?.[1];

  const currentChapter = url.searchParams.get("capitulo");

  if (chapterId && currentChapter && chapterId !== currentChapter) {
    url.pathname = url.pathname.replace(
      new RegExp(`/${currentChapter}(?=/conteudos(?:$|/))`),
      `/${chapterId}`,
    );
  }

  if (chapterId) url.searchParams.set("capitulo", chapterId);
  url.searchParams.set("conteudo", match[1]);

  return url.href;
}

const TOPIC_BADGE_PATTERN =
  /^(?:aula|lesson|v[ií]deo|video|sess[aã]o|session|epis[oó]dio|episode|cap[ií]tulo|chapter|encontro|workshop|palestra|talk|live|conte[uú]do|content|conclu[ií]d[oa]s?|completed|em\s+andamento|in\s+progress)$/i;

const TOPIC_BADGE_SUFFIX_PATTERN =
  /\b(?:aula|item|v[ií]deo|video|sess[aã]o|session|epis[oó]dio|episode|cap[ií]tulo|chapter|encontro|workshop|palestra|talk|live|conclu[ií]d[oa]s?|completed)\s*$/i;

const SECTION_COUNT_PATTERN =
  /^\d+\s+(?:aulas?|lessons?|sess[oõ]es?|sess[aã]o|sessions?|v[ií]deos?|videos?|epis[oó]dios?|episodes?|cap[ií]tulos?|chapters?|encontros?|workshops?|palestras?|talks?|lives?|m[oó]dulos?|modules?|itens?|items?)$/i;

const ACTION_BUTTON_PATTERN =
  /^(?:concluir|conclu[ií]d[oa]s?|completed|marcar|desmarcar|completar|finalizar|próxim[oa]|anterior|voltar|fechar|abrir|recolher|expandir)\b/i;

function tryParseUrl(
  value: string,
  base: string | URL = location.href,
): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isHiddenElement(element: Element): boolean {
  return (
    /^(SVG|SCRIPT|STYLE|NOSCRIPT)$/i.test(element.tagName) ||
    element.getAttribute("aria-hidden") === "true" ||
    /\b(?:sr-only|visually-hidden)\b/i.test(
      typeof element.className === "string" ? element.className : "",
    )
  );
}

function collectVisibleTextNodes(node: Node): string[] {
  return [...node.childNodes].flatMap((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      return (child.textContent || "")
        .split(/\r?\n/)
        .map(cleanText)
        .filter(Boolean);
    }

    if (child.nodeType !== Node.ELEMENT_NODE) return [];
    const childElement = child as Element;

    if (isHiddenElement(childElement) || childElement.hasAttribute("hidden")) {
      return [];
    }

    return collectVisibleTextNodes(childElement);
  });
}

function elementTextLines(element: Element): string[] {
  const visible = collectVisibleTextNodes(element);

  if (visible.length) return visible;

  if (element instanceof HTMLElement && element.innerText) {
    return element.innerText.split(/\r?\n/).map(cleanText).filter(Boolean);
  }

  return [];
}

function topicTitle(item: Element): string {
  const lines = elementTextLines(item);

  const title =
    lines.find(
      (line) =>
        !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line) &&
        !TOPIC_BADGE_PATTERN.test(line),
    ) || "Topic";

  // A duration can share a line with the title when the page uses inline text.
  return (
    cleanText(title.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?$/, "")) || "Topic"
  );
}

/**
 * Creates one playlist item from a page item when it has a usable item id
 * and destination URL.
 */
function outlineTopic(
  item: Element,
  currentUrl: URL,
  fileTitle: string,
  folderPath: readonly string[],
): TrackOutlineTopic | null {
  const idMatch = /^list-content-(\d+)$/.exec(item.id);
  const url = topicUrl(item, currentUrl);

  if (!idMatch || !url) return null;

  return { id: idMatch[1], url, fileTitle, folderPath };
}

function fallbackSectionTitle(item: Element): string {
  const list = item.parentElement;
  const previous = list?.previousElementSibling;
  const heading = previous?.querySelector("h1, h2, h3, h4, [role=button]");

  return cleanText(heading?.textContent || previous?.textContent || "Topics");
}

function ancestorChainWithin(
  element: Element,
  boundary: Element | null,
): Element[] {
  const parent = element.parentElement;

  if (!parent || parent === boundary) return [];
  if (boundary && !boundary.contains(parent)) return [];

  return [parent, ...ancestorChainWithin(parent, boundary)];
}

function sectionHeadingFromCardHeader(sibling: Element): string {
  if (sibling.querySelectorAll("button").length > 1) return "";
  const lines = elementTextLines(sibling);

  if (!lines.some((line) => SECTION_COUNT_PATTERN.test(line))) return "";

  return (
    lines.find(
      (line) =>
        !SECTION_COUNT_PATTERN.test(line) &&
        !TOPIC_BADGE_PATTERN.test(line) &&
        isSectionHeadingText(line),
    ) || ""
  );
}

function sidebarSectionTitle(item: Element): string {
  const sidebar = item.closest("aside, [role=complementary]");

  // Card-based sidebars group items inside a generic card whose header
  // sibling shows the section name and a "N aulas" count.
  const cardHeading = ancestorChainWithin(item, sidebar)
    .flatMap((parent) =>
      [...parent.children].filter((sibling) => !sibling.contains(item)),
    )
    .map(sectionHeadingFromCardHeader)
    .find(Boolean);

  if (cardHeading) return cardHeading;

  const container = item.closest(
    "section, [role=group], [class*=section], [class*=module], [class*=accordion]",
  );

  if (container && (!sidebar || sidebar.contains(container))) {
    const heading = container.querySelector("h1, h2, h3, h4, h5, h6");
    const headingText = cleanText(heading?.textContent || "");

    if (isSectionHeadingText(headingText)) return headingText;

    const lineHeading = elementTextLines(container).find(
      (line) =>
        isSectionHeadingText(line) &&
        !TOPIC_BADGE_PATTERN.test(line) &&
        !TOPIC_BADGE_SUFFIX_PATTERN.test(line),
    );

    if (lineHeading) return lineHeading;
  }

  return "Topics";
}

function serializedSidebarTopicUrls(current: URL): string[] {
  const serializedPage = (document.documentElement?.innerHTML || "").replaceAll(
    "\\/",
    "/",
  );

  const matches = serializedPage.matchAll(
    /\/c\/[^/?#"'<]+\/sections\/[^/?#"'<]+\/lessons\/[^/?#"'<]+/gi,
  );

  const urls = new Set<string>();

  for (const match of matches) urls.add(new URL(match[0], current).href);

  const topicIds = serializedPage.matchAll(
    /["'](?:lesson(?:_|-)?id|content(?:_|-)?id)["']\s*:\s*["']([^"']+)["']/gi,
  );

  for (const match of topicIds) {
    const path = current.pathname.replace(
      /(\/lessons\/)[^/]+/i,
      `$1${encodeURIComponent(match[1])}`,
    );

    if (path !== current.pathname) urls.add(new URL(path, current).href);
  }

  return [...urls];
}

function resetSubtitleTrackingForNavigation(): void {
  sentTracks.clear();

  contentState.resourceScanFloor =
    typeof performance?.getEntriesByType === "function"
      ? performance.getEntriesByType("resource").length
      : 0;
}

function reportPageLocation(): void {
  if (isHiddenHelperFrame) return;
  if (contentState.lastReportedPageUrl === location.href) return;

  if (contentState.lastReportedPageUrl) {
    resetSubtitleTrackingForNavigation();
  }

  contentState.lastReportedPageUrl = location.href;
  contentState.lastOutlineFingerprint = "";
  offscreenOutlineState.cachedUrl = "";
  offscreenOutlineState.cachedOutline = null;

  chrome.runtime
    .sendMessage({
      type: "page-location",
      url: contentState.lastReportedPageUrl,
    })
    .catch(() => {});
}

function isThumbnailTopicRow(
  element: Element,
  lines: readonly string[],
  last: string,
): boolean {
  return (
    Boolean(element.querySelector("img")) &&
    lines.length >= 2 &&
    last.length > 0 &&
    last.length <= 24 &&
    !SECTION_COUNT_PATTERN.test(last) &&
    !/^\d+\s+/.test(last) &&
    !ACTION_BUTTON_PATTERN.test(lines[0] || "")
  );
}

function isSidebarTopicElement(element: Element): boolean {
  if (element.closest("header")) return false;
  const lines = elementTextLines(element);

  if (lines.length >= 2) {
    const last = lines[lines.length - 1];

    const hasTitle = lines.some(
      (line) =>
        !TOPIC_BADGE_PATTERN.test(line) &&
        !SECTION_COUNT_PATTERN.test(line) &&
        !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line),
    );

    if (
      hasTitle &&
      (TOPIC_BADGE_PATTERN.test(last) ||
        isThumbnailTopicRow(element, lines, last))
    ) {
      return true;
    }
  }

  const combined = cleanText(lines.join(" "));

  return (
    TOPIC_BADGE_SUFFIX_PATTERN.test(combined) &&
    !ACTION_BUTTON_PATTERN.test(combined) &&
    !SECTION_COUNT_PATTERN.test(combined) &&
    !/\b\d+\s+(?:aulas?|lessons?|sess[oõ]es?|sessions?)\s*$/i.test(combined) &&
    !TOPIC_BADGE_PATTERN.test(combined)
  );
}

/** Returns the item controls rendered by a sidebar-only playlist player. */
function sidebarTopicButtons(): Element[] {
  return [
    ...document.querySelectorAll("aside button, [role=complementary] button"),
  ].filter((button) => isSidebarTopicElement(button));
}

function normalizeTopicKey(value: string): string {
  return normalizeTopicTitleKey(cleanText(value));
}

function scorePageLinkedVideoUrl(rawHref: string): number {
  return scoreLinkedVideoUrl(rawHref, location.href);
}

function isOutsideTopicBody(
  element: Element,
  commentsBoundary: Element | null,
): boolean {
  if (
    element.closest(
      "header, nav, aside, footer, [role=complementary], [class*=comment], [data-testid*=comment]",
    )
  ) {
    return true;
  }

  if (
    commentsBoundary &&
    (commentsBoundary.contains(element) ||
      Boolean(
        commentsBoundary.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ))
  ) {
    return true;
  }

  return false;
}

function findTopicCommentsBoundary(root: Element): Element | null {
  return (
    [...root.querySelectorAll("[role=tab], h2, h3, h4, section")].find((el) =>
      /^(?:coment[áa]rios|comments)\b/i.test(cleanText(el.textContent || "")),
    ) || null
  );
}

function resolveDomElementUrl(rawAttr: string): string {
  const trimmed = rawAttr.trim();

  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^(?:data|blob|javascript):/i.test(trimmed)
  ) {
    return "";
  }

  const parsed = tryParseUrl(trimmed, document.baseURI);

  if (
    !parsed ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    return "";
  }

  return parsed.href;
}

function filenameFromUrlPath(rawUrl: string): string {
  const parsed = tryParseUrl(rawUrl);

  if (!parsed) return "";
  const segment = parsed.pathname.split("/").filter(Boolean).pop() || "";

  if (!segment) return "";

  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

function fileCardName(card: Element, resolvedUrl: string): string {
  const lines = elementTextLines(card);

  const fileLine = lines.find(
    (line) => /\.pdf$/i.test(line) || /^[^/\\]+\.[a-z0-9]{2,5}$/i.test(line),
  );

  if (fileLine) return fileLine;

  return filenameFromUrlPath(resolvedUrl) || cleanText(card.textContent || "");
}

interface DomTopicImageInput {
  readonly url: string;
  readonly alt?: string;
  readonly filename?: string;
}

interface DomTopicLinkInput {
  readonly url: string;
  readonly text?: string;
}

function collectDomTopicImages(
  root: Element,
  commentsBoundary: Element | null,
): DomTopicImageInput[] {
  const images: DomTopicImageInput[] = [];

  for (const img of root.querySelectorAll("img")) {
    if (
      img.classList.contains("ProseMirror-separator") ||
      img.closest(
        '[data-testid="editor-content-blocks-file-card"], .node-embed, [data-testid*="embed" i], [class*="oembed" i], [data-component="VideoPlayer"], action-text-attachment[content-type*="video"], media-theme, media-controller, hls-video, mux-video, video',
      ) ||
      isOutsideTopicBody(img, commentsBoundary)
    ) {
      continue;
    }

    const url = resolveDomElementUrl(
      img.getAttribute("src") || img.getAttribute("data-src") || "",
    );

    if (!url) continue;

    const alt = (img.getAttribute("alt") || "").trim();

    const filename =
      (
        img.getAttribute("data-filename") ||
        img.getAttribute("title") ||
        img.closest("action-text-attachment")?.getAttribute("filename") ||
        ""
      ).trim() || filenameFromUrlPath(url);

    images.push({
      url,
      ...(alt ? { alt } : {}),
      ...(filename ? { filename } : {}),
    });
  }

  return images;
}

function collectDomActionTextAttachments(
  root: Element,
  commentsBoundary: Element | null,
  links: DomTopicLinkInput[],
): void {
  for (const attachment of root.querySelectorAll("action-text-attachment")) {
    if (isOutsideTopicBody(attachment, commentsBoundary)) continue;
    const url = resolveDomElementUrl(attachment.getAttribute("url") || "");

    if (!url) continue;
    const contentType = (attachment.getAttribute("content-type") || "").trim();
    const name = (attachment.getAttribute("filename") || "").trim();

    if (
      /^application\/pdf\b/i.test(contentType) ||
      /\.pdf(?:$|[?#])/i.test(url) ||
      /\.pdf$/i.test(name)
    ) {
      links.push({
        url,
        text: name || filenameFromUrlPath(url) || "document.pdf",
      });
    }
  }
}

function collectDomTopicFileCards(
  root: Element,
  commentsBoundary: Element | null,
  images: DomTopicImageInput[],
  links: DomTopicLinkInput[],
): void {
  for (const card of root.querySelectorAll(
    '[data-testid="editor-content-blocks-file-card"]',
  )) {
    if (isOutsideTopicBody(card, commentsBoundary)) continue;

    const preview = card.querySelector("img");
    const imgSrc = resolveDomElementUrl(preview?.getAttribute("src") || "");

    if (!imgSrc) continue;

    const resolvedUrl = activeStorageBlobUrl(imgSrc) || imgSrc;
    const cardFilename = fileCardName(card, resolvedUrl);

    if (/\.pdf(?:$|[?#])/i.test(resolvedUrl) || /\.pdf\b/i.test(cardFilename)) {
      links.push({ url: resolvedUrl, text: cardFilename });
      continue;
    }

    if (/\.(?:png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(resolvedUrl)) {
      images.push({
        url: resolvedUrl,
        ...(cardFilename ? { filename: cardFilename } : {}),
      });
    }
  }
}

function collectDomTopicAnchors(
  root: Element,
  commentsBoundary: Element | null,
  links: DomTopicLinkInput[],
): void {
  for (const anchor of root.querySelectorAll("a[href]")) {
    if (isOutsideTopicBody(anchor, commentsBoundary)) continue;

    const url = resolveDomElementUrl(anchor.getAttribute("href") || "");

    if (!url) continue;

    links.push({ url, text: cleanText(anchor.textContent || "") });
  }
}

function classifyDomIframe(
  iframe: Element,
  links: DomTopicLinkInput[],
  seenSrc: Set<string>,
): EmbeddedVideoLink | null {
  const src = resolveDomElementUrl(iframe.getAttribute("src") || "");

  if (!src || seenSrc.has(src)) return null;
  seenSrc.add(src);
  const title = cleanText(iframe.getAttribute("title") || "");

  if (isExcalidrawUrl(src)) {
    links.push({ url: src, text: title || "Excalidraw diagram" });

    return null;
  }

  if (isSlidesDeckUrl(src, title)) {
    links.push({ url: src, text: title || "Slides" });

    return null;
  }

  const normalized = normalizeEmbeddedVideoUrl(src, location.href);

  if (
    !normalized ||
    !/(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(new URL(normalized).hostname)
  ) {
    return null;
  }

  return Object.freeze({
    url: normalized,
    ...(title ? { title } : {}),
  });
}

function collectDomTopicIframes(
  roots: readonly Element[],
  commentsBoundary: Element | null,
  links: DomTopicLinkInput[],
): EmbeddedVideoLink | null {
  const seenSrc = new Set<string>();

  const holder: { embeddedVideo: EmbeddedVideoLink | null } = {
    embeddedVideo: null,
  };

  for (const scope of roots) {
    for (const iframe of scope.querySelectorAll("iframe[src]")) {
      if (isOutsideTopicBody(iframe, commentsBoundary)) continue;
      const candidate = classifyDomIframe(iframe, links, seenSrc);

      if (candidate && !holder.embeddedVideo) {
        holder.embeddedVideo = candidate;
      }
    }
  }

  return holder.embeddedVideo;
}

function extractTopicCompanionDocumentsFromDom(): TopicCompanionDocuments | null {
  const editorRoot = document.querySelector(
    '[data-testid="tip-tap-editor-content"] [data-circle="rich-text-content"], [data-testid="tip-tap-editor-content"], [data-circle="event-body"], [data-testid="post-body"], article .ProseMirror, main .ProseMirror, main .trix-content, article .trix-content',
  );

  const mainRoot = document.querySelector("main, [role=main]");
  const primaryRoot = editorRoot || mainRoot;

  if (!primaryRoot || isOutsideTopicBody(primaryRoot, null)) return null;

  const commentsBoundary = findTopicCommentsBoundary(mainRoot || primaryRoot);

  const images = editorRoot
    ? collectDomTopicImages(editorRoot, commentsBoundary)
    : [];

  const links: DomTopicLinkInput[] = [];

  if (editorRoot) {
    collectDomTopicFileCards(editorRoot, commentsBoundary, images, links);
    collectDomTopicAnchors(editorRoot, commentsBoundary, links);
    collectDomActionTextAttachments(editorRoot, commentsBoundary, links);
  }

  const iframeScopes = [
    ...(editorRoot ? [editorRoot] : []),
    ...(mainRoot && mainRoot !== editorRoot ? [mainRoot] : []),
  ];

  const embeddedVideo = collectDomTopicIframes(
    iframeScopes,
    commentsBoundary,
    links,
  );

  if (!editorRoot && !embeddedVideo && !links.length) return null;

  const documents = extractTopicCompanionDocumentsFromLinksAndHtml({
    title: currentPageHeading(),
    pageUrl: location.href,
    html: editorRoot ? editorRoot.innerHTML : "",
    images,
    links,
    embeddedVideo,
  });

  return countTopicCompanionDocuments(documents) ? documents : null;
}

function collectDomDirectVideoUrl(): string {
  const root = document.querySelector("main, [role=main]") || document.body;

  if (!root) return "";
  const commentsBoundary = findTopicCommentsBoundary(root);

  const elements = root.querySelectorAll(
    "media-theme[downloadurl], video source[src], video[src]",
  );

  for (const element of elements) {
    if (isOutsideTopicBody(element, commentsBoundary)) continue;

    const rawAttr = element.matches("media-theme")
      ? element.getAttribute("downloadurl") || ""
      : element.getAttribute("src") || "";

    const url = resolveDomElementUrl(rawAttr);

    if (url && isDirectVideoUrl(url)) return url;
  }

  return "";
}

/**
 * Inspects the active item body (<main>) for a link, embed iframe, or
 * clickable internal post card pointing to another video when the item
 * itself has no native HLS player.
 */
function findLinkedVideoInPage(): LinkedVideoResult {
  const root = document.querySelector("main, [role=main]") || document.body;

  if (!root) return { ok: false };

  const commentsBoundary = findTopicCommentsBoundary(root);

  // 1. Embedded video iframe inside the item body.
  for (const iframe of root.querySelectorAll("iframe[src]")) {
    if (isOutsideTopicBody(iframe, commentsBoundary)) continue;
    const src = iframe.getAttribute("src") || "";

    if (scorePageLinkedVideoUrl(src) >= 30) {
      return { ok: true, url: new URL(src, location.href).href };
    }
  }

  // 2. Highest-scoring video/community link inside the item body.
  const bestLink = [...root.querySelectorAll("a[href], [data-href]")]
    .filter((anchor) => !isOutsideTopicBody(anchor, commentsBoundary))
    .map((anchor): LinkedVideoCandidate | null => {
      const raw =
        anchor.getAttribute("href") || anchor.getAttribute("data-href") || "";

      const baseScore = scorePageLinkedVideoUrl(raw);

      if (baseScore <= 0) return null;
      const text = cleanText(elementTextLines(anchor).join(" "));

      const bonus =
        /\b(?:aula|v[ií]deo|meetup|live|workshop|assistir|watch|lesson)\b/i.test(
          text,
        )
          ? 10
          : 0;

      const title =
        text.length >= 6 &&
        !/^(?:https?:\/\/|clique|acesse|assistir|ver|aqui|link)/i.test(text)
          ? text
          : "";

      const parsed = tryParseUrl(raw);

      return parsed
        ? Object.freeze({ url: parsed.href, score: baseScore + bonus, title })
        : null;
    })
    .filter(
      (candidate): candidate is LinkedVideoCandidate => candidate !== null,
    )
    .sort((left, right) => right.score - left.score)[0];

  if (bestLink) return { ok: true, url: bestLink.url, title: bestLink.title };

  // 3. Clickable internal post/item button inside the item body when the
  //    playlist player renders internal post references as buttons without href.
  for (const button of root.querySelectorAll("button")) {
    if (
      isOutsideTopicBody(button, commentsBoundary) ||
      button.closest("[aria-label*='video' i], [aria-label*='player' i]")
    ) {
      continue;
    }

    const text = cleanText(elementTextLines(button).join(" "));

    if (
      !text ||
      text.length > 220 ||
      ACTION_BUTTON_PATTERN.test(text) ||
      /^(?:mostrar|ocultar|ver thread|enviar|anexar|adicionar|play|pause|mute|settings|\d{1,2}:\d{2})$/i.test(
        text,
      )
    ) {
      continue;
    }

    if (
      /\b(?:aula|v[ií]deo|meetup|live|workshop|grava[cç][aã]o|assistir|watch|lesson|skills)\b/i.test(
        text,
      ) &&
      button instanceof HTMLElement
    ) {
      button.click();

      return { ok: true, clicked: true, title: text };
    }
  }

  return { ok: false };
}

function isActiveRowMatchingTarget(
  activeRow: Element | null,
  buttons: readonly Element[],
  normalizedTarget: string,
  normalizedSection: string,
): boolean {
  if (
    !activeRow ||
    normalizeTopicKey(topicTitle(activeRow)) !== normalizedTarget
  ) {
    return false;
  }

  if (!normalizedSection) return true;

  const hasSidebarCandidate = buttons.some(
    (button) => normalizeTopicKey(topicTitle(button)) === normalizedTarget,
  );

  if (!hasSidebarCandidate) return true;

  return (
    normalizeTopicKey(sidebarSectionTitle(activeRow)) === normalizedSection
  );
}

function matchingSidebarButton(
  buttons: readonly Element[],
  normalizedTarget: string,
  normalizedSection: string,
): Element | null {
  const titleMatches = buttons.filter(
    (button) => normalizeTopicKey(topicTitle(button)) === normalizedTarget,
  );

  if (titleMatches.length <= 1 || !normalizedSection) {
    return titleMatches[0] ?? null;
  }

  return (
    titleMatches.find(
      (button) =>
        normalizeTopicKey(sidebarSectionTitle(button)) === normalizedSection,
    ) ??
    titleMatches[0] ??
    null
  );
}

/**
 * Waits briefly for a sidebar-only playlist player to finish rendering, expands
 * any collapsed sections, then clicks the requested sidebar item button
 * (preferring an exact title + section match so reused worker frames stay
 * accurate even when the active row moves, duplicate titles exist across
 * sections, or sections hydrate asynchronously).
 */
function clickSidebarTopic(
  topicIndex: number | undefined,
  targetTitle = "",
  targetSection = "",
): Promise<SidebarClickResult> {
  const normalizedTarget = targetTitle ? normalizeTopicKey(targetTitle) : "";

  const normalizedSection = targetSection
    ? normalizeTopicKey(targetSection)
    : "";

  const clickButton = (button: HTMLElement): SidebarClickResult => {
    resetSubtitleTrackingForNavigation();
    button.click();

    return { ok: true };
  };

  const tryClick = (allowIndexFallback = false): SidebarClickResult | null => {
    const expanded = expandSidebarSections();
    const buttons = sidebarTopicButtons();

    if (!buttons.length) return null;

    if (normalizedTarget) {
      const sidebar = buttons[0].closest("aside, [role=complementary]");

      const activeRow = sidebar
        ? findActiveSidebarTopic(sidebar, buttons)
        : null;

      if (
        isActiveRowMatchingTarget(
          activeRow,
          buttons,
          normalizedTarget,
          normalizedSection,
        )
      ) {
        return { ok: true, alreadyActive: true };
      }

      const byTitle = matchingSidebarButton(
        buttons,
        normalizedTarget,
        normalizedSection,
      );

      if (byTitle instanceof HTMLElement) return clickButton(byTitle);
      if (expanded || !allowIndexFallback) return null;
    }

    const button =
      typeof topicIndex === "number" && Number.isInteger(topicIndex)
        ? buttons[topicIndex]
        : null;

    return button instanceof HTMLElement ? clickButton(button) : null;
  };

  const immediate = tryClick(false);

  if (immediate) return Promise.resolve(immediate);

  return new Promise<SidebarClickResult>((resolve) => {
    const finish = (result: SidebarClickResult | null): void => {
      clearTimeout(timeout);
      observer.disconnect();
      resolve(result || { ok: false });
    };

    const observer = new MutationObserver(() => {
      const result = tryClick(false);

      if (result) finish(result);
    });

    const timeout = setTimeout(() => finish(tryClick(true)), 5000);

    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  });
}

function activeRowFromBadge(
  candidate: Element,
  sidebar: Element,
  buttonSet: ReadonlySet<Element>,
): Element | null {
  const validAncestors: Element[] = [];

  for (const current of ancestorChainWithin(candidate, sidebar)) {
    if (
      buttonSet.has(current) ||
      current.querySelector("button") ||
      elementTextLines(current).some((line) => SECTION_COUNT_PATTERN.test(line))
    ) {
      break;
    }

    const badgeCount = elementTextLines(current).filter((line) =>
      TOPIC_BADGE_PATTERN.test(line),
    ).length;

    if (badgeCount > 1) break;
    if (isSidebarTopicElement(current)) validAncestors.push(current);
  }

  return validAncestors.at(-1) || null;
}

/**
 * Finds the active (currently open) item row when the player renders it as a
 * non-button container alongside the sidebar item buttons.
 */
function findActiveSidebarTopic(
  sidebar: Element,
  buttons: readonly Element[],
): Element | null {
  const buttonSet = new Set(buttons);

  const byBadge =
    [...sidebar.querySelectorAll("span, div, p")]
      .filter((candidate) => !candidate.closest("button"))
      .filter((candidate) =>
        TOPIC_BADGE_PATTERN.test(
          cleanText(elementTextLines(candidate).join(" ")),
        ),
      )
      .map((candidate) => activeRowFromBadge(candidate, sidebar, buttonSet))
      .find((row): row is Element => row !== null) || null;

  if (byBadge) return byBadge;

  // Fallback for custom playlist nouns (e.g., "Mentoria", "Desafio") when the
  // active row is a non-button thumbnail card rendered beside item buttons.
  const buttonParents = new Set(
    buttons
      .map((button) => button.parentElement)
      .filter((parent): parent is HTMLElement => parent !== null),
  );

  for (const parent of buttonParents) {
    const siblingRow = [...parent.children].find(
      (child) =>
        !buttonSet.has(child) &&
        !child.querySelector("button") &&
        isSidebarTopicElement(child),
    );

    if (siblingRow) return siblingRow;
  }

  return null;
}

/**
 * Converts sidebar controls into a navigable item list in exact sidebar DOM
 * order. The player changes items through button clicks and does not expose
 * a distinct item URL.
 */
function buttonSidebarTopics(current: URL): ButtonSidebarTopic[] {
  const buttons = sidebarTopicButtons();

  if (!buttons.length) return [];
  const sidebar = buttons[0].closest("aside, [role=complementary]");
  const activeRow = sidebar ? findActiveSidebarTopic(sidebar, buttons) : null;

  const entries = buttons.map((button, navigationIndex) => ({
    element: button,
    id: `sidebar-topic-${navigationIndex}`,
    url: current.href,
    title: topicTitle(button),
    section: sidebarSectionTitle(button),
    navigationIndex,
  }));

  if (activeRow) {
    entries.push({
      element: activeRow,
      id: "current-topic",
      url: current.href,
      title: topicTitle(activeRow),
      section: sidebarSectionTitle(activeRow),
      navigationIndex: -1,
    });

    entries.sort((left, right) => {
      if (left.element === right.element) return 0;

      return left.element.compareDocumentPosition(right.element) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });

    return entries.map(({ element: _element, ...item }) => item);
  }

  const currentTitle =
    cleanText(
      document.querySelector("main h1, main h2, [role=main] h1, [role=main] h2")
        ?.textContent || "",
    ) || "Current topic";

  return [
    {
      id: "current-topic",
      url: current.href,
      title: currentTitle,
      section: "Topics",
      navigationIndex: -1,
    },
    ...entries.map(({ element: _element, ...item }) => item),
  ];
}

/** Reports item links from a rendered sidebar without navigating the tab. */
const topicPath = /\/sections\/([^/?#]+)\/lessons\/([^/?#]+)/i;

function isSectionHeadingText(value: string): boolean {
  return (
    Boolean(value) &&
    !SECTION_COUNT_PATTERN.test(value) &&
    !/^\d{1,2}:\d{2}$/.test(value) &&
    !/^(concluir|conclu[ií]d[oa]s?|completed|marcar|desmarcar)\b/i.test(
      value,
    ) &&
    !/^(?:(?:aula|sess[aã]o)\s+bloqueada|(?:locked|blocked)\s+(?:lesson|session))$/i.test(
      value,
    )
  );
}

/**
 * Reads the playlist name from the page header without the header's action
 * buttons, such as "Concluir aula", which would otherwise become part of it.
 */
function sidebarTrackTitle(): string {
  const header = document.querySelector("header");

  if (header) {
    const copy = header.cloneNode(true);

    if (copy instanceof Element) {
      copy
        .querySelectorAll("button, [role=button], svg, script, style")
        .forEach((element) => element.remove());

      const line = (copy.textContent || "")
        .split(/\r?\n/)
        .map(cleanText)
        .find(isSectionHeadingText);

      if (line) return line;
    }
  }

  const fromTitle = cleanText(document.title.split(/[|·–-]/).at(-1) || "");

  if (fromTitle) return fromTitle;
  const slug = /^\/c\/([^/]+)/i.exec(location.pathname)?.[1] || "Track";

  return cleanText(decodeURIComponent(slug).replace(/-/g, " "));
}

/**
 * Finds the item links of a sidebar-only playlist player. Items are found
 * from their links, grouped by the section id in each link, and listed once in
 * page order. Sidebar links are preferred so that "next item" links elsewhere
 * on the page cannot change the order.
 */
function sidebarTopicLinks(
  current: URL,
  sidebarOnly = false,
): SidebarTopicEntry[] {
  const byTopic = new Map<string, SidebarTopicEntry>();

  const add = (href: string, element: Element | null): void => {
    const url = tryParseUrl(href, current);

    if (!url) return;
    const match = topicPath.exec(url.pathname);

    if (!match || byTopic.has(match[2])) return;
    const title = element ? topicTitle(element) : "Topic";
    const heading = element ? sidebarSectionTitle(element) : "";

    byTopic.set(
      match[2],
      Object.freeze({
        id: match[2],
        url: url.href,
        title,
        sectionKey: match[1],
        sectionTitle: heading && heading !== title ? heading : "",
      }),
    );
  };

  const addLinks = (selector: string): void => {
    for (const candidate of document.querySelectorAll(selector)) {
      const href =
        candidate.getAttribute("href") || candidate.getAttribute("data-href");

      if (href) add(href, candidate);
    }
  };

  addLinks(
    "aside a[href], [role=complementary] a[href], nav a[href], aside [data-href]",
  );

  if (sidebarOnly) return [...byTopic.values()];

  if (byTopic.size < 2) addLinks("a[href], [data-href]");

  if (byTopic.size < 2) {
    for (const href of serializedSidebarTopicUrls(current)) add(href, null);
  }

  return [...byTopic.values()];
}

/** Opens collapsed sidebar sections once so that all of their items render. */
const expandedSidebarControls = new WeakSet<Element>();

function expandSidebarSections(): boolean {
  const controls = [
    ...document.querySelectorAll(
      'aside [aria-expanded="false"], [role=complementary] [aria-expanded="false"]',
    ),
  ].filter((control) => {
    const label = cleanText(
      control.getAttribute("aria-label") || control.textContent || "",
    );

    return (
      !expandedSidebarControls.has(control) &&
      !control.hasAttribute("aria-haspopup") &&
      !control.closest("header") &&
      Boolean(label) &&
      !/^(?:fechar|abrir|barra|sidebar|menu|close|toggle|mostrar)\b/i.test(
        label,
      )
    );
  });

  controls.forEach((control) => {
    expandedSidebarControls.add(control);
    if (control instanceof HTMLElement) control.click();
  });

  return controls.length > 0;
}

function resolvedSidebarTopics(current: URL): SidebarTopicEntry[] {
  const buttons = buttonSidebarTopics(current).map((item) =>
    Object.freeze({
      ...item,
      sectionKey: item.section,
      sectionTitle: item.section,
    }),
  );

  const links = sidebarTopicLinks(current, buttons.length >= 2);

  return buttons.length > links.length ? buttons : links;
}

function buildSidebarTrackOutline(): TrackOutline | null {
  if (
    !/^\/c\/[^/]+\/sections\/[^/]+\/lessons\/[^/]+/i.test(location.pathname)
  ) {
    return null;
  }

  const current = new URL(location.href);
  const trackTitle = sidebarTrackTitle();
  const found = resolvedSidebarTopics(current);

  if (found.length < 2) return null;
  const sections = new Map<string, SidebarSectionAccumulator>();

  for (const item of found) {
    const existing = sections.get(item.sectionKey);

    const section = existing || {
      number: sections.size + 1,
      title: `Section ${sections.size + 1}`,
      titled: false,
      count: 0,
    };

    if (!existing) sections.set(item.sectionKey, section);

    if (!section.titled && item.sectionTitle) {
      section.title = item.sectionTitle;
      section.titled = true;
    }
  }

  const items = found.flatMap((item): TrackOutlineTopic[] => {
    const section = sections.get(item.sectionKey);

    if (!section) return [];
    section.count += 1;

    return [
      {
        id: item.id,
        url: item.url,
        fileTitle: `${section.number}.${section.count} ${item.title}`,
        folderPath: [
          trackRootFolderName(trackTitle, location.href),
          `${section.number}. ${section.title}`,
        ],
        ...(typeof item.navigationIndex === "number" &&
        Number.isInteger(item.navigationIndex)
          ? { navigationIndex: item.navigationIndex }
          : {}),
      },
    ];
  });

  return { title: trackTitle, items };
}

function isTrackOutlinePayload(value: unknown): value is TrackOutline {
  return (
    isObjectRecord(value) &&
    typeof value.title === "string" &&
    Array.isArray(value.items) &&
    value.items.length >= 2
  );
}

/**
 * Reads the full desktop sidebar outline inside a short-lived invisible
 * 1440x900 offscreen iframe when a responsive playlist page unmounts or hides
 * its sidebar on medium/small viewports.
 */
function collectOffscreenDesktopOutline(): Promise<TrackOutline | null> {
  if (isHiddenHelperFrame || window.top !== window) {
    return Promise.resolve(null);
  }

  if (offscreenOutlineState.cachedUrl === location.href) {
    return Promise.resolve(offscreenOutlineState.cachedOutline);
  }

  if (offscreenOutlineState.inFlight) return offscreenOutlineState.inFlight;
  const targetUrl = location.href;

  offscreenOutlineState.attemptedUrls.add(targetUrl);
  const requestId = crypto.randomUUID();

  const pending = new Promise<TrackOutline | null>((resolve) => {
    const frame = document.createElement("iframe");

    frame.name = `${hiddenOutlinePrefix}${requestId}`;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = OFFSCREEN_DESKTOP_STYLE;
    frame.src = targetUrl;

    const mountFrame = (): void => {
      (document.body || document.documentElement)?.append(frame);
    };

    const cleanup = (outline: TrackOutline | null): void => {
      clearTimeout(timeout);
      window.removeEventListener("DOMContentLoaded", mountFrame);
      window.removeEventListener("message", onMessage);
      frame.remove();
      offscreenOutlineState.inFlight = null;

      if (location.href === targetUrl && outline) {
        offscreenOutlineState.cachedUrl = targetUrl;
        offscreenOutlineState.cachedOutline = outline;
      }

      resolve(outline);
    };

    const onMessage = (event: MessageEvent<unknown>): void => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.contentWindow ||
        !isObjectRecord(event.data) ||
        event.data.source !== "opfs-media-packager" ||
        event.data.type !== "offscreen-track-outline" ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      cleanup(
        isTrackOutlinePayload(event.data.outline) ? event.data.outline : null,
      );
    };

    const timeout = setTimeout(() => cleanup(null), 4500);

    window.addEventListener("message", onMessage);

    if (document.body) {
      mountFrame();
    }

    if (!document.body) {
      window.addEventListener("DOMContentLoaded", mountFrame, { once: true });
    }
  });

  offscreenOutlineState.inFlight = pending;

  return pending;
}

function publishTrackOutline(
  outline: TrackOutline,
  force: boolean,
): Promise<unknown> | undefined {
  const fingerprint = JSON.stringify(outline);

  if (!force && fingerprint === contentState.lastOutlineFingerprint) return;
  contentState.lastOutlineFingerprint = fingerprint;

  return chrome.runtime
    .sendMessage({ type: "track-outline", outline })
    .catch(() => {});
}

/** Reports item links from a rendered sidebar without navigating the tab. */
function reportSidebarTrackOutline(
  force = false,
): Promise<unknown> | undefined {
  if (
    !/^\/c\/[^/]+\/sections\/[^/]+\/lessons\/[^/]+/i.test(location.pathname)
  ) {
    return;
  }

  const visibleOutline = buildSidebarTrackOutline();

  const hasMountedSidebar =
    Boolean(document.querySelector("aside, [role=complementary]")) &&
    sidebarTopicButtons().length > 0;

  if (
    visibleOutline &&
    (hasMountedSidebar || visibleOutline.items.length >= 3)
  ) {
    return publishTrackOutline(visibleOutline, force);
  }

  if (
    !force &&
    (window.innerWidth >= 1024 ||
      offscreenOutlineState.attemptedUrls.has(location.href))
  ) {
    return visibleOutline
      ? publishTrackOutline(visibleOutline, force)
      : undefined;
  }

  return collectOffscreenDesktopOutline().then((desktopOutline) => {
    const chosen =
      desktopOutline &&
      desktopOutline.items.length >= (visibleOutline?.items.length || 0)
        ? desktopOutline
        : visibleOutline;

    if (!chosen) return;

    return publishTrackOutline(chosen, force);
  });
}

/** Reports the playlist tree in DOM order; the worker probes stream capability. */
function reportTrackOutline(force = false): Promise<unknown> | undefined {
  if (isHiddenHelperFrame) return;

  if (/^\/c\/[^/]+\/sections\/[^/]+\/lessons\/[^/]+/i.test(location.pathname)) {
    return reportSidebarTrackOutline(force);
  }

  if (!/\/courses\//i.test(location.pathname)) return;
  const currentUrl = new URL(location.href);
  const rootName = cleanText(document.title.split("|").at(-1) || "Playlist");

  const chapterTopics = [
    ...document.querySelectorAll('[id^="chapter-"]'),
  ].flatMap((chapter, chapterIndex) => {
    const section = chapterTitle(chapter);

    return [...chapter.querySelectorAll('[id^="list-content-"]')]
      .map((item, topicIndex) =>
        outlineTopic(
          item,
          currentUrl,
          `${chapterIndex + 1}.${topicIndex + 1} ${topicTitle(item)}`,
          [
            trackRootFolderName(rootName, location.href),
            `${chapterIndex + 1}. ${section}`,
          ],
        ),
      )
      .filter((item): item is TrackOutlineTopic => item !== null);
  });

  const items = chapterTopics.length
    ? chapterTopics
    : (() => {
        const sectionNumbers = new Map<string, number>();
        const topicNumbers = new Map<string, number>();

        return [...document.querySelectorAll('[id^="list-content-"]')]
          .map((item) => {
            const section = fallbackSectionTitle(item);

            const sectionNumber =
              sectionNumbers.get(section) || sectionNumbers.size + 1;

            sectionNumbers.set(section, sectionNumber);
            const topicNumber = (topicNumbers.get(section) || 0) + 1;

            topicNumbers.set(section, topicNumber);

            return outlineTopic(
              item,
              currentUrl,
              `${sectionNumber}.${topicNumber} ${topicTitle(item)}`,
              [
                trackRootFolderName(rootName, location.href),
                `${sectionNumber}. ${section}`,
              ],
            );
          })
          .filter((item): item is TrackOutlineTopic => item !== null);
      })();

  const unique = items.filter(
    (item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index,
  );

  if (!unique.length) return;

  return publishTrackOutline({ title: rootName, items: unique }, force);
}

const SUBTITLE_TRACK_SELECTOR =
  'track[kind="subtitles"], track[kind="captions"], track[src$=".vtt"], track[src*=".vtt?"]';

function collectDomTrackElements(): HTMLTrackElement[] {
  const roots: ParentNode[] = [document];

  for (const host of document.querySelectorAll(
    "hls-video, mux-video, video-js, media-controller, [data-player]",
  )) {
    if (host.shadowRoot) roots.push(host.shadowRoot);
  }

  return roots.flatMap((root) => [
    ...root.querySelectorAll<HTMLTrackElement>(SUBTITLE_TRACK_SELECTOR),
  ]);
}

function collectPerformanceSubtitleTracks(
  seen: Set<string>,
): PageSubtitleTrack[] {
  if (typeof performance?.getEntriesByType !== "function") return [];

  const entries = performance
    .getEntriesByType("resource")
    .slice(contentState.resourceScanFloor)
    .reverse();

  return entries
    .map((entry): PageSubtitleTrack | null => {
      const parsed = tryParseUrl(entry.name || "");

      if (
        !parsed ||
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        !isSubtitleResourceUrl(parsed.href) ||
        seen.has(parsed.href)
      ) {
        return null;
      }

      seen.add(parsed.href);

      return Object.freeze({
        url: parsed.href,
        language: "Subtitle",
        label: "",
      });
    })
    .filter((track): track is PageSubtitleTrack => track !== null);
}

/** Collects all subtitle/caption tracks currently declared in the DOM or fetched by the page. */
function collectPageSubtitleTracks(): PageSubtitleTrack[] {
  const seen = new Set<string>();

  const domTracks = collectDomTrackElements()
    .map((element): PageSubtitleTrack | null => {
      if ((element.getAttribute("kind") || "").toLowerCase() === "metadata") {
        return null;
      }

      const parsed = tryParseUrl(
        element.getAttribute("src") || "",
        document.baseURI,
      );

      if (
        !parsed ||
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        isStoryboardSubtitleUrl(parsed.href) ||
        seen.has(parsed.href)
      ) {
        return null;
      }

      seen.add(parsed.href);

      const language =
        element.getAttribute("srclang") ||
        element.getAttribute("lang") ||
        element.label ||
        "Subtitle";

      return Object.freeze({
        url: parsed.href,
        language,
        label: element.label || language,
      });
    })
    .filter((track): track is PageSubtitleTrack => track !== null);

  return [...domTracks, ...collectPerformanceSubtitleTracks(seen)];
}

/** Reports newly declared subtitle tracks to the extension. */
function reportTracks(force = false): void {
  if (currentHiddenOutlineId) return;
  const tracks: PageSubtitleTrack[] = [];

  for (const track of collectPageSubtitleTracks()) {
    if (!force && sentTracks.has(track.url)) continue;
    sentTracks.add(track.url);
    tracks.push(track);
  }

  if (tracks.length) {
    chrome.runtime
      .sendMessage({ type: "page-subtitle-tracks", tracks })
      .catch(() => {});
  }
}

function runHiddenOutlineFrameCollector(): void {
  const state: {
    done: boolean;
    best: TrackOutline | null;
    settleTimer: ReturnType<typeof setTimeout> | null;
  } = {
    done: false,
    best: null,
    settleTimer: null,
  };

  const finish = (): void => {
    if (state.done) return;
    state.done = true;
    clearTimeout(hardTimer);
    if (state.settleTimer !== null) clearTimeout(state.settleTimer);
    observer.disconnect();

    window.parent.postMessage(
      {
        source: "opfs-media-packager",
        type: "offscreen-track-outline",
        requestId: currentHiddenOutlineId,
        outline: state.best,
      },
      location.origin,
    );
  };

  const inspect = (): void => {
    if (state.done) return;
    expandSidebarSections();
    const outline = buildSidebarTrackOutline();

    if (!outline || outline.items.length <= (state.best?.items.length || 0)) {
      return;
    }

    state.best = outline;
    if (state.settleTimer !== null) clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(finish, 250);
  };

  const observer = new MutationObserver(inspect);
  const hardTimer = setTimeout(finish, 3800);

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });

  inspect();
}

if (currentHiddenOutlineId) {
  runHiddenOutlineFrameCollector();
}

if (currentHiddenProbeId) {
  chrome.runtime
    .sendMessage({
      type: "hidden-probe-frame-ready",
      probeId: currentHiddenProbeId,
    })
    .catch(() => {});
}

if (currentHiddenDiagramToken) {
  chrome.runtime
    .sendMessage({
      type: "diagram-frame-ready",
      token: currentHiddenDiagramToken,
    })
    .catch(() => {});
}

if (currentHiddenSlidesToken) {
  chrome.runtime
    .sendMessage({
      type: "slides-frame-ready",
      token: currentHiddenSlidesToken,
    })
    .catch(() => {});
}

if (
  !currentHiddenOutlineId &&
  !currentHiddenDiagramToken &&
  !currentHiddenSlidesToken
) {
  reportPageLocation();
  reportTracks();
  reportTrackOutline();

  new MutationObserver(() => {
    reportPageLocation();
    reportTracks();
    reportTrackOutline();
  }).observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srclang", "lang", "label"],
  });
}
