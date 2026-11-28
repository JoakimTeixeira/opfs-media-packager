// This main-world probe observes playlist content requests made by the signed-in
// page and runs headless parallel probes on demand. It emits only media URLs,
// never headers, cookies, tokens, or raw response payloads.
import {
  normalizeTopicTitleKey,
  trackRootFolderName,
} from "../lib/track/track-plan.ts";
import {
  countTopicCompanionDocuments,
  emptyTopicCompanionDocuments,
  extractFeaturedMediaEmbed,
  extractTopicCompanionDocumentsFromLinksAndHtml,
  extractTopicCompanionDocumentsFromRichText,
  extractTopicFileAttachments,
  extractRichTextLinkedPostUrls,
  mergeTopicCompanionDocuments,
  withEmbeddedVideoMarkdown,
  type TopicCompanionDocuments,
} from "../lib/materials/topic-assets.ts";
import {
  isSupplementaryLinkedPostUrl,
  scoreLinkedVideoUrl as scoreSharedLinkedVideoUrl,
} from "../lib/materials/linked-video.ts";
import { normalizeEmbedPlayerUrl } from "../lib/media/embed-player.ts";
import { isDirectVideoUrl } from "../lib/media/stream-identity.ts";
import { isStoryboardSubtitleUrl } from "../lib/subtitles/subtitle-tracks.ts";

interface ProbeWindow extends Window {
  __opfsMediaPackagerProbeLoaded?: boolean;
}

interface TrackedXMLHttpRequest extends XMLHttpRequest {
  __hlsDirectSaverUrl?: string;
  __hlsDirectSaverHeaders?: Record<string, string>;
}

interface ProbeSubtitleTrack {
  readonly url: string;
  readonly language: string;
  readonly label: string;
}

interface ProbedStream {
  readonly url: string;
  readonly mediaUrl: string;
  readonly embedUrl?: string;
  readonly subtitles: readonly ProbeSubtitleTrack[];
  readonly linkedTitle?: string;
  readonly sourceUrl?: string;
  readonly documents?: TopicCompanionDocuments;
  readonly linkedUrls?: readonly string[];
}

interface KnownTopicEntry {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly title: string;
  readonly mediaUrl: string;
  readonly subtitles: readonly ProbeSubtitleTrack[];
}

interface ApiTrackTemplate {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly withCredentials: boolean;
  readonly topicIdToken?: string;
}

interface GenericTopicTemplate {
  readonly url: string;
  readonly topicId: string;
  readonly sectionId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly withCredentials: boolean;
}

interface ObservedState {
  apiTrackTemplate: ApiTrackTemplate | null;
  genericTopicTemplate: GenericTopicTemplate | null;
  spaceId: string;
  publishedSpaceOutlineFingerprint: string;
  scannedDomProps: boolean;
  scannedPerformanceResources: boolean;
  defaultApiEndpointFailed: boolean;
}

interface ExtractedMedia {
  readonly mediaUrl: string;
  readonly subtitles: readonly ProbeSubtitleTrack[];
}

interface PropsMediaAndTitle {
  readonly mediaUrl: string;
  readonly subtitles: readonly ProbeSubtitleTrack[];
  readonly title: string;
  readonly documents?: TopicCompanionDocuments | null;
}

interface GenericPayloadOutcome {
  readonly payload: unknown;
  readonly rateLimited: boolean;
}

interface LinkedTopicApiResult {
  readonly stream: ProbedStream | null;
  readonly rateLimited: boolean;
}

interface LinkedHtmlResult {
  readonly stream: ProbedStream | null;
  readonly iframeUrl: string;
  readonly rateLimited: boolean;
}

interface LinkedVideoResolution {
  readonly stream: ProbedStream | null;
  readonly fallbackUrl: string;
  readonly rateLimited: boolean;
}

interface DecodedEnvelopeResult {
  readonly validEnvelope: boolean;
  readonly stream: ProbedStream | null;
}

interface ThrottleDecision {
  readonly shouldRetry: boolean;
  readonly cooldownMs: number;
}

interface OriginFetchOutcome {
  readonly response: Response | null;
  readonly status: number;
  readonly rateLimited: boolean;
}

interface ApiTrackAttempt {
  readonly ok: boolean;
  readonly status: number;
  readonly rateLimited?: boolean;
  readonly retry?: boolean;
  readonly stream: ProbedStream | null;
}

interface HeadlessProbeResult {
  readonly checked: boolean;
  readonly stream: ProbedStream | null;
  readonly linkedUrl: string;
  readonly linkedUrls?: readonly string[];
  readonly rateLimited?: boolean;
}

interface ProbeTopicInput {
  readonly topicIndex: number;
  readonly id: string;
  readonly title: string;
  readonly sectionTitle?: string;
  readonly url: string;
}

interface TopicStackEntry {
  readonly node: unknown;
  readonly sectionId: string;
  readonly sectionTitle: string;
}

interface PageMediaResponse {
  readonly status: number;
  readonly body: string;
}

(() => {
  const probeWindow = window as ProbeWindow;

  if (probeWindow.__opfsMediaPackagerProbeLoaded) return;
  probeWindow.__opfsMediaPackagerProbeLoaded = true;
  const apiContentPath = /(?:^|\/)cursos\/conteudo\/(\d+)\.json(?:[?#]|$)/;

  const sidebarRoutePath =
    /^\/c\/([^/]+)\/sections\/([^/]+)\/lessons\/([^/]+)/i;

  const m3u8Pattern = /https?:\/\/[^\s"'<>\\]+?\.m3u8?(?:\?[^\s"'<>\\]*)?/gi;

  const subtitlePattern =
    /https?:\/\/[^\s"'<>\\]+?\.(?:vtt|srt|ttml|dfxp)(?:\?[^\s"'<>\\]*)?/gi;

  const absoluteUrlPattern = /https:\/\/[^\s"'<>\\]+/gi;

  const relativeTrackLinkPattern =
    /(?:href=["']|["'])(\/(?:c\/[^/"'<>\\s]+\/[^"'<>\\s]+|courses\/[^"'<>\\s]+))["']/gi;

  const videoPlayerHostPattern =
    /(?:^|\.)(?:vimeo\.com|loom\.com|mediadelivery\.net|wistia\.com|wistia\.net|cloudflarestream\.com|videodelivery\.net|mux\.com|jwplayer\.com|vidyard\.com|sproutvideo\.com|brightcove\.net|vzaar\.com)$|^(?:player|embed|stream|video)\./i;

  const ignoredLinkKeys = new Set([
    "next_lesson_url",
    "previous_lesson_url",
    "prev_lesson_url",
    "next_lesson",
    "previous_lesson",
    "prev_lesson",
    "course_url",
    "space_url",
    "community_url",
    "canonical_url",
    "share_url",
    "avatar_url",
    "thumbnail_url",
    "cover_image_url",
    "image_url",
    "icon_url",
    "author",
    "user",
    "creator",
    "member",
    "comments",
    "sections",
  ]);

  const API_PLAYLIST_CONCURRENCY = 1;
  const API_PLAYLIST_PACE_MS = 550;
  const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5000;
  const MAX_RATE_LIMIT_COOLDOWN_MS = 15000;

  const RATE_LIMITED_PROBE_RESULT: HeadlessProbeResult = Object.freeze({
    checked: false,
    stream: null,
    linkedUrl: "",
    rateLimited: true,
  });

  const originRateLimiter = {
    nextSlotAt: 0,
    blockedUntil: 0,
    consecutive429s: 0,
    tripped: false,
  };

  const nativeFetch: typeof fetch | null =
    typeof window.fetch === "function" ? window.fetch.bind(window) : null;

  // Kept strictly inside this closure; never serialized or sent out of the page.
  const observedState: ObservedState = {
    apiTrackTemplate: null,
    genericTopicTemplate: null,
    spaceId: "",
    publishedSpaceOutlineFingerprint: "",
    scannedDomProps: false,
    scannedPerformanceResources: false,
    defaultApiEndpointFailed: false,
  };

  const cachedStreamsById = new Map<string, ProbedStream>();

  const cachedFileAttachmentsByTopicId = new Map<
    string,
    TopicCompanionDocuments
  >();

  const cachedTopicDocumentsByTopicId = new Map<
    string,
    TopicCompanionDocuments
  >();

  const knownTopicsByTitle = new Map<string, KnownTopicEntry>();
  const knownTopicsBySectionAndTitle = new Map<string, KnownTopicEntry>();
  const knownTopicsById = new Map<string, KnownTopicEntry>();

  function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object");
  }

  function tryParseUrl(value: string, base = location.href): URL | null {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  }

  function tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function lookupKnownTopic(
    title: string,
    sectionTitle = "",
  ): KnownTopicEntry | undefined {
    const key = normalizeTopicTitleKey(title);

    if (!key) return undefined;

    const sectionKey = sectionTitle ? normalizeTopicTitleKey(sectionTitle) : "";

    if (sectionKey) {
      const scoped = knownTopicsBySectionAndTitle.get(`${sectionKey}::${key}`);

      if (scoped) return scoped;
    }

    return knownTopicsByTitle.get(key);
  }

  function isSafeHttpsUrl(value: string): boolean {
    const parsed = tryParseUrl(value);

    return Boolean(
      parsed &&
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password,
    );
  }

  function embeddedMediaUrl(value: unknown): string {
    if (!isObjectRecord(value)) return "";

    const match = Object.entries(value).find(
      ([key, candidate]) =>
        /^video_url_[a-z0-9_]+$/i.test(key) &&
        typeof candidate === "string" &&
        candidate.length > 0,
    );

    return typeof match?.[1] === "string" ? match[1] : "";
  }

  function scorePlaylistUrl(url: string): number {
    return (
      (/playlist\.m3u8|master\.m3u8/i.test(url) ? 10 : 0) +
      (/\/hls\//i.test(url) ? 5 : 0) +
      (/\/\d{3,4}p\//i.test(url) ? -3 : 0)
    );
  }

  function decodeHtmlEntities(value: string): string {
    return value
      .replaceAll("\\/", "/")
      .replaceAll("\\u0026", "&")
      .replaceAll("\\u002F", "/")
      .replaceAll("\\u002f", "/")
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }

  function cleanCandidateUrl(value: string): string {
    return decodeHtmlEntities(value).replace(/[),.;]+$/, "");
  }

  function scoreLinkedVideoUrl(candidate: string, currentUrl: string): number {
    const cleaned = cleanCandidateUrl(candidate);

    if (!isSafeHttpsUrl(cleaned)) return 0;

    return scoreSharedLinkedVideoUrl(cleaned, currentUrl);
  }

  function extractLinkedUrlsFromText(
    text: string,
    currentUrl: string,
  ): string[] {
    if (!text) return [];
    const normalized = decodeHtmlEntities(text);
    const scored = new Map<string, number>();

    const consider = (raw: string): void => {
      const parsed = tryParseUrl(cleanCandidateUrl(raw), location.origin);

      if (!parsed) return;
      const score = scoreLinkedVideoUrl(parsed.href, currentUrl);

      if (score > 0 && score > (scored.get(parsed.href) || 0)) {
        scored.set(parsed.href, score);
      }
    };

    for (const match of normalized.matchAll(absoluteUrlPattern)) {
      consider(match[0]);
    }

    for (const match of normalized.matchAll(relativeTrackLinkPattern)) {
      consider(match[1]);
    }

    return topScoredUrls(scored);
  }

  function topScoredUrls(scored: ReadonlyMap<string, number>): string[] {
    return [...scored.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([url]) => url)
      .slice(0, 5);
  }

  function childValuesSkippingIgnoredKeys(node: object): unknown[] {
    if (Array.isArray(node)) return [...node].reverse();

    return Object.entries(node as Record<string, unknown>)
      .filter(([key]) => !ignoredLinkKeys.has(key.toLowerCase()))
      .map(([, value]) => value);
  }

  function scoreLinkedUrlsInString(
    text: string,
    currentUrl: string,
    scored: Map<string, number>,
  ): void {
    if (
      !text.includes("https://") &&
      !text.includes("/c/") &&
      !text.includes("/courses/")
    ) {
      return;
    }

    for (const url of extractLinkedUrlsFromText(text, currentUrl)) {
      const score = scoreLinkedVideoUrl(url, currentUrl);

      if (score > (scored.get(url) || 0)) scored.set(url, score);
    }
  }

  function extractLinkedUrlsFromJson(
    root: unknown,
    currentUrl: string,
  ): string[] {
    const scored = new Map<string, number>();
    const stack: unknown[] = [root];
    const cursor = { visited: 0 };

    while (stack.length && cursor.visited < 5000) {
      cursor.visited += 1;
      const current = stack.pop();

      if (!current) continue;

      if (typeof current === "string") {
        scoreLinkedUrlsInString(current, currentUrl, scored);
        continue;
      }

      if (typeof current === "object") {
        stack.push(...childValuesSkippingIgnoredKeys(current));
      }
    }

    return topScoredUrls(scored);
  }

  function cleanLinkedPageTitle(rawTitle: string): string {
    const cleaned = decodeHtmlEntities(String(rawTitle || ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return "";

    return cleaned.replace(/\s+[|·]\s+[^|·]{2,60}$/, "").trim() || cleaned;
  }

  function extractTitleFromHtml(html: string): string {
    const ogTitle =
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(
        html,
      ) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(
        html,
      );

    if (ogTitle?.[1]) return cleanLinkedPageTitle(ogTitle[1]);
    const h1 = /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i.exec(html);

    if (h1?.[1]) return cleanLinkedPageTitle(h1[1]);
    const titleTag = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html);

    if (titleTag?.[1]) return cleanLinkedPageTitle(titleTag[1]);

    return "";
  }

  function extractPropsTitle(parsed: Record<string, unknown>): string {
    const post = isObjectRecord(parsed.post) ? parsed.post : null;
    const item = isObjectRecord(parsed.lesson) ? parsed.lesson : null;

    const candidate =
      post?.name ||
      post?.title ||
      item?.name ||
      item?.title ||
      parsed.name ||
      parsed.title ||
      "";

    return typeof candidate === "string" && candidate.trim()
      ? cleanLinkedPageTitle(candidate)
      : "";
  }

  function extractPropsMediaAndTitle(
    html: string,
    pageUrl: string,
  ): PropsMediaAndTitle {
    const entries = [...html.matchAll(/data-props=(["'])([\s\S]*?)\1/gi)]
      .filter((match) => Boolean(match[2]) && match[2].length <= 4_000_000)
      .map((match) => tryParseJson(decodeHtmlEntities(match[2])))
      .filter(isObjectRecord);

    const mediaResults = entries.map(extractMediaFromJson);

    const mediaUrl =
      mediaResults.map((item) => item.mediaUrl).find(Boolean) || "";

    const subtitles = mediaResults.flatMap((item) => [...item.subtitles]);
    const title = entries.map(extractPropsTitle).find(Boolean) || "";

    const documents =
      entries
        .map((entry) => extractDocumentsFromPayload(entry, title, pageUrl))
        .find((item): item is TopicCompanionDocuments => item !== null) || null;

    return Object.freeze({ mediaUrl, subtitles, title, documents });
  }

  function firstStringField(
    record: Record<string, unknown>,
    keys: readonly string[],
  ): string {
    const key = keys.find((candidate) => typeof record[candidate] === "string");

    return key ? (record[key] as string) : "";
  }

  const EXPLICIT_SUBTITLE_URL_KEYS: readonly string[] = [
    "webvtt_file_url",
    "vtt_url",
    "subtitle_url",
    "captions_url",
    "transcript_url",
  ];

  function isSkippedSubtitleRecord(
    record: Record<string, unknown>,
    trackKind: string,
  ): boolean {
    if (
      trackKind === "metadata" ||
      trackKind === "thumbnails" ||
      trackKind === "chapters"
    ) {
      return true;
    }

    const hasExplicitUrl = Boolean(
      firstStringField(record, EXPLICIT_SUBTITLE_URL_KEYS),
    );

    return record.enabled === false && !hasExplicitUrl;
  }

  function subtitleMetadataFromRecord(record: Record<string, unknown>): {
    readonly language: string;
    readonly label: string;
  } {
    const language = firstStringField(record, [
      "srclang",
      "language",
      "lang",
      "language_code",
    ]).trim();

    const label = firstStringField(record, ["label", "name"]).trim();

    return { language, label };
  }

  function mediaTranscriptUrlFromRecord(
    record: Record<string, unknown>,
  ): string {
    const rawId = record.media_transcript_id;

    if (
      (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) ||
      (typeof rawId === "string" && /^\d+$/.test(rawId))
    ) {
      return new URL(`/media_transcripts/${rawId}.vtt`, location.origin).href;
    }

    return "";
  }

  function subtitleTrackFromRecord(
    record: Record<string, unknown>,
  ): ProbeSubtitleTrack | null {
    const trackKind = firstStringField(record, ["kind"]).toLowerCase();

    if (isSkippedSubtitleRecord(record, trackKind)) return null;

    const explicitSubtitleUrl = firstStringField(record, [
      "webvtt_file_url",
      "vtt_url",
      "subtitle_url",
      "captions_url",
      "transcript_url",
    ]);

    const rawUrl =
      explicitSubtitleUrl ||
      firstStringField(record, ["src", "url", "file_url"]);

    if (!rawUrl || isStoryboardSubtitleUrl(rawUrl)) return null;

    const isSubtitleRecord =
      Boolean(explicitSubtitleUrl) ||
      /\.(?:vtt|srt|ttml|dfxp)(?:[?#]|$)/i.test(rawUrl) ||
      trackKind === "subtitles" ||
      trackKind === "captions";

    if (!isSubtitleRecord) return null;

    const { language, label } = subtitleMetadataFromRecord(record);

    return Object.freeze({ url: rawUrl, language, label });
  }

  function subtitleTracksFromRecord(
    record: Record<string, unknown>,
  ): readonly ProbeSubtitleTrack[] {
    const trackKind = firstStringField(record, ["kind"]).toLowerCase();

    if (isSkippedSubtitleRecord(record, trackKind)) return [];

    const tracks: ProbeSubtitleTrack[] = [];
    const directTrack = subtitleTrackFromRecord(record);

    if (directTrack) tracks.push(directTrack);

    const transcriptUrl = mediaTranscriptUrlFromRecord(record);

    if (transcriptUrl) {
      const { language, label } = subtitleMetadataFromRecord(record);

      tracks.push(Object.freeze({ url: transcriptUrl, language, label }));
    }

    return tracks;
  }

  const GENERIC_ITEM_KEYS: readonly string[] = [
    "rich_text_body",
    "tiptap_body",
    "featured_media",
  ];

  function recordHasGenericTopicKey(record: Record<string, unknown>): boolean {
    return GENERIC_ITEM_KEYS.some((key) => key in record);
  }

  function looksLikeGenericTopicPayload(parsed: unknown): boolean {
    if (!isObjectRecord(parsed)) return false;
    if (recordHasGenericTopicKey(parsed)) return true;

    const item = isObjectRecord(parsed.lesson) ? parsed.lesson : null;
    const post = isObjectRecord(parsed.post) ? parsed.post : null;

    return Boolean(
      (item && recordHasGenericTopicKey(item)) ||
      (post && recordHasGenericTopicKey(post)),
    );
  }

  function extractRichTextField(payload: unknown): unknown {
    return (
      nestedTopicField(payload, "rich_text_body") ??
      nestedTopicField(payload, "tiptap_body")
    );
  }

  function extractDocumentsFromPayload(
    payload: unknown,
    title: string,
    pageUrl: string,
  ): TopicCompanionDocuments | null {
    if (!isObjectRecord(payload)) return null;

    const item = isObjectRecord(payload.lesson) ? payload.lesson : null;
    const post = isObjectRecord(payload.post) ? payload.post : null;
    const resolvedTitle = title.trim() || extractPropsTitle(payload);
    const embeddedVideo = extractFeaturedMediaEmbed(payload, pageUrl);
    const richTextBody = extractRichTextField(payload);

    if (richTextBody) {
      const richDocuments = extractTopicCompanionDocumentsFromRichText(
        richTextBody,
        {
          title: resolvedTitle,
          pageUrl,
          embeddedVideo,
        },
      );

      if (countTopicCompanionDocuments(richDocuments) > 0) return richDocuments;
    }

    const bodyHtml =
      firstStringField(payload, ["body_html", "body_trix_content"]) ||
      (item
        ? firstStringField(item, ["body_html", "body_trix_content"])
        : "") ||
      (post ? firstStringField(post, ["body_html", "body_trix_content"]) : "");

    if (bodyHtml) {
      const htmlDocuments = extractTopicCompanionDocumentsFromLinksAndHtml({
        title: resolvedTitle,
        pageUrl,
        html: bodyHtml,
        embeddedVideo,
      });

      if (countTopicCompanionDocuments(htmlDocuments) > 0) return htmlDocuments;
    }

    if (!embeddedVideo) return null;

    const videoOnlyDocuments = withEmbeddedVideoMarkdown(
      emptyTopicCompanionDocuments(),
      embeddedVideo,
      resolvedTitle,
    );

    return countTopicCompanionDocuments(videoOnlyDocuments) > 0
      ? videoOnlyDocuments
      : null;
  }

  const DIRECT_VIDEO_RECORD_KEYS: readonly string[] = [
    "blob_url",
    "downloadurl",
    "download_url",
    "playback_url",
    "video_url",
    "original",
    "mp4",
    "src",
    "url",
  ];

  function directVideosFromRecord(
    record: Record<string, unknown>,
  ): readonly string[] {
    const results: string[] = [];

    for (const key of DIRECT_VIDEO_RECORD_KEYS) {
      const value = record[key];

      if (typeof value !== "string") continue;
      const cleaned = cleanCandidateUrl(decodeHtmlEntities(value));

      if (isSafeHttpsUrl(cleaned) && isDirectVideoUrl(cleaned)) {
        results.push(cleaned);
      }
    }

    return results;
  }

  function appendUniqueMediaUrls(
    candidates: readonly string[],
    seen: Set<string>,
    target: string[],
  ): void {
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      target.push(candidate);
    }
  }

  /**
   * Walks a parsed JSON payload breadth-first so top-level media/subtitle
   * fields are always visited before deep rich-text bodies.
   */
  function extractMediaFromJson(root: unknown): ExtractedMedia {
    const playlists: string[] = [];
    const directVideos: string[] = [];
    const subtitles: ProbeSubtitleTrack[] = [];
    const seen = new Set<string>();
    const queue: unknown[] = [root];

    const addSubtitle = (rawUrl: string, language = "", label = ""): void => {
      const cleaned = cleanCandidateUrl(rawUrl);

      if (
        !isSafeHttpsUrl(cleaned) ||
        isStoryboardSubtitleUrl(cleaned) ||
        seen.has(cleaned)
      ) {
        return;
      }

      seen.add(cleaned);

      subtitles.push(
        Object.freeze({
          url: cleaned,
          language: typeof language === "string" ? language.trim() : "",
          label: typeof label === "string" ? label.trim() : "",
        }),
      );
    };

    const scanString = (value: string): void => {
      const normalized =
        value.includes("\\/") ||
        value.includes("&amp;") ||
        value.includes("\\u0026")
          ? decodeHtmlEntities(value)
          : value;

      if (normalized.includes(".m3u8") || normalized.includes(".m3u")) {
        for (const match of normalized.matchAll(m3u8Pattern)) {
          const cleaned = cleanCandidateUrl(match[0]);

          if (isSafeHttpsUrl(cleaned) && !seen.has(cleaned)) {
            seen.add(cleaned);
            playlists.push(cleaned);
          }
        }
      }

      if (/\.(?:vtt|srt|ttml|dfxp)/i.test(normalized)) {
        for (const match of normalized.matchAll(subtitlePattern)) {
          addSubtitle(match[0]);
        }
      }
    };

    const cursor = { head: 0 };

    while (cursor.head < queue.length && cursor.head < 30000) {
      const current = queue[cursor.head];

      cursor.head += 1;
      if (!current) continue;

      if (typeof current === "string") {
        scanString(current);
        continue;
      }

      if (typeof current !== "object") continue;

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      const record = current as Record<string, unknown>;

      for (const track of subtitleTracksFromRecord(record)) {
        addSubtitle(track.url, track.language, track.label);
      }

      appendUniqueMediaUrls(directVideosFromRecord(record), seen, directVideos);

      queue.push(...Object.values(record));
    }

    playlists.sort(
      (left, right) => scorePlaylistUrl(right) - scorePlaylistUrl(left),
    );

    return Object.freeze({
      mediaUrl: playlists[0] || directVideos[0] || "",
      subtitles: Object.freeze(subtitles.slice(0, 10)),
    });
  }

  function substituteTemplateIds(
    templateUrl: string,
    fromTopicId: string,
    toTopicId: string,
    fromSectionId: string,
    toSectionId: string,
  ): string {
    const withTopic = templateUrl.replaceAll(
      fromTopicId,
      encodeURIComponent(toTopicId),
    );

    if (!fromSectionId || !toSectionId) return withTopic;

    return withTopic.replaceAll(fromSectionId, encodeURIComponent(toSectionId));
  }

  const EMPTY_LINKED_HTML_RESULT: LinkedHtmlResult = Object.freeze({
    stream: null,
    iframeUrl: "",
    rateLimited: false,
  });

  /**
   * Fetches a item JSON payload using the observed generic item API template.
   */
  async function fetchGenericTopicPayload(
    template: GenericTopicTemplate,
    topicId: string,
    sectionId: string,
  ): Promise<GenericPayloadOutcome> {
    const targetUrl = substituteTemplateIds(
      template.url,
      template.topicId,
      topicId,
      template.sectionId,
      sectionId,
    );

    const outcome = await fetchOriginResponseWithBackoff(targetUrl, {
      cache: "no-store",
      credentials:
        template.withCredentials === false ? "same-origin" : "include",
      headers: template.headers,
    });

    if (!outcome.response) {
      return Object.freeze({
        payload: null,
        rateLimited: outcome.rateLimited,
      });
    }

    try {
      return Object.freeze({
        payload: await outcome.response.json(),
        rateLimited: false,
      });
    } catch {
      return Object.freeze({ payload: null, rateLimited: false });
    }
  }

  async function resolveLinkedTopicViaApi(
    parsed: URL,
    linkedTopicRoute: RegExpExecArray,
  ): Promise<LinkedTopicApiResult> {
    const template = observedState.genericTopicTemplate;

    if (!template || parsed.origin !== location.origin) {
      return Object.freeze({ stream: null, rateLimited: false });
    }

    const fetched = await fetchGenericTopicPayload(
      template,
      linkedTopicRoute[3],
      linkedTopicRoute[2],
    );

    if (fetched.rateLimited || !fetched.payload) {
      return Object.freeze({
        stream: null,
        rateLimited: fetched.rateLimited,
      });
    }

    const media = extractMediaFromJson(fetched.payload);
    const record = isObjectRecord(fetched.payload) ? fetched.payload : null;
    const nestedTopic = isObjectRecord(record?.lesson) ? record.lesson : null;
    const nestedPost = isObjectRecord(record?.post) ? record.post : null;

    const rawLinkedTitle =
      record?.name ||
      record?.title ||
      nestedTopic?.name ||
      nestedPost?.name ||
      "";

    const linkedTitle = cleanLinkedPageTitle(
      typeof rawLinkedTitle === "string" ? rawLinkedTitle : "",
    );

    const documents = extractDocumentsFromPayload(
      fetched.payload,
      linkedTitle,
      parsed.href,
    );

    if (!media.mediaUrl && !documents) {
      return Object.freeze({ stream: null, rateLimited: false });
    }

    return Object.freeze({
      stream: Object.freeze({
        url: "",
        mediaUrl: media.mediaUrl,
        subtitles: media.subtitles,
        linkedTitle,
        sourceUrl: parsed.href,
        ...(documents ? { documents } : {}),
      }),
      rateLimited: false,
    });
  }

  function hasHtmlVideoPlayerMarker(html: string): boolean {
    return /<(?:video|media-theme|hls-video|mux-video)\b|data-component=["']VideoPlayer["']/i.test(
      html,
    );
  }

  async function resolveLinkedPageHtml(parsed: URL): Promise<LinkedHtmlResult> {
    if (parsed.origin !== location.origin) return EMPTY_LINKED_HTML_RESULT;

    const outcome = await fetchOriginResponseWithBackoff(parsed.href, {
      cache: "no-store",
      credentials: "include",
    });

    if (!outcome.response) {
      return Object.freeze({
        stream: null,
        iframeUrl: "",
        rateLimited: outcome.rateLimited,
      });
    }

    try {
      const rawHtml = await outcome.response.text();
      const propsResult = extractPropsMediaAndTitle(rawHtml, parsed.href);
      const html = decodeHtmlEntities(rawHtml);

      const playlists = [
        ...(propsResult.mediaUrl ? [propsResult.mediaUrl] : []),
        ...[...html.matchAll(m3u8Pattern)]
          .map((match) => cleanCandidateUrl(match[0]))
          .filter(isSafeHttpsUrl),
      ].sort((left, right) => scorePlaylistUrl(right) - scorePlaylistUrl(left));

      const linkedTitle = propsResult.title || extractTitleFromHtml(rawHtml);

      if (playlists.length) {
        const htmlSubtitles = [...html.matchAll(subtitlePattern)]
          .map((match) => cleanCandidateUrl(match[0]))
          .filter((url) => isSafeHttpsUrl(url) && !isStoryboardSubtitleUrl(url))
          .map((url) => Object.freeze({ url, language: "", label: "" }));

        const subtitles = [...propsResult.subtitles, ...htmlSubtitles]
          .filter(
            (track, index, all) =>
              all.findIndex((other) => other.url === track.url) === index,
          )
          .slice(0, 10);

        return Object.freeze({
          stream: Object.freeze({
            url: "",
            mediaUrl: playlists[0],
            subtitles: Object.freeze(subtitles),
            linkedTitle,
            sourceUrl: parsed.href,
            ...(propsResult.documents
              ? { documents: propsResult.documents }
              : {}),
          }),
          iframeUrl: "",
          rateLimited: false,
        });
      }

      const iframeMatch = /<iframe[^>]+src=["'](https:\/\/[^"']+)["']/i.exec(
        html,
      );

      const iframeUrl =
        iframeMatch && scoreLinkedVideoUrl(iframeMatch[1], parsed.href) >= 32
          ? cleanCandidateUrl(iframeMatch[1])
          : "";

      if (
        !iframeUrl &&
        propsResult.documents &&
        !hasHtmlVideoPlayerMarker(html)
      ) {
        return Object.freeze({
          stream: Object.freeze({
            url: "",
            mediaUrl: "",
            subtitles: Object.freeze([]),
            linkedTitle,
            sourceUrl: parsed.href,
            documents: propsResult.documents,
          }),
          iframeUrl: "",
          rateLimited: false,
        });
      }

      return Object.freeze({ stream: null, iframeUrl, rateLimited: false });
    } catch {
      return EMPTY_LINKED_HTML_RESULT;
    }
  }

  async function resolveSingleLinkedCandidate(
    candidateUrl: string,
  ): Promise<LinkedHtmlResult> {
    const parsed = tryParseUrl(candidateUrl);

    if (!parsed) return EMPTY_LINKED_HTML_RESULT;
    const linkedTopicRoute = sidebarRoutePath.exec(parsed.pathname);

    if (linkedTopicRoute) {
      const viaApi = await resolveLinkedTopicViaApi(parsed, linkedTopicRoute);

      if (viaApi.rateLimited || viaApi.stream) {
        return Object.freeze({
          stream: viaApi.stream,
          iframeUrl: "",
          rateLimited: viaApi.rateLimited,
        });
      }
    }

    return resolveLinkedPageHtml(parsed);
  }

  /**
   * Attempts to resolve a linked video page (such as another post or item)
   * headlessly via fetch(). Returns the discovered stream (with the linked
   * video's own title and subtitles) or the best URL for worker fallback.
   */
  async function resolveLinkedVideoHeadless(
    candidateUrls: readonly string[],
  ): Promise<LinkedVideoResolution> {
    const candidates = candidateUrls.slice(0, 3);
    const preferredFallbacks: string[] = [];

    for (const candidateUrl of candidates) {
      const resolved = await resolveSingleLinkedCandidate(candidateUrl);

      if (resolved.rateLimited) {
        return Object.freeze({
          stream: null,
          fallbackUrl: "",
          rateLimited: true,
        });
      }

      if (resolved.stream) {
        return Object.freeze({
          stream: resolved.stream,
          fallbackUrl: "",
          rateLimited: false,
        });
      }

      if (resolved.iframeUrl) preferredFallbacks.push(resolved.iframeUrl);
    }

    return Object.freeze({
      stream: null,
      fallbackUrl: preferredFallbacks[0] || candidates[0] || "",
      rateLimited: false,
    });
  }

  const ITEM_MARKER_KEYS = Object.freeze([
    "section_id",
    "sectionId",
    "course_section_id",
    "capitulo_id",
    "lesson_type",
    "lessonType",
    "tipo",
    "is_completed",
    "completed",
    "status",
    "featured_media",
    "duration",
    "video",
  ]);

  function validIdentifierString(rawValue: unknown): string {
    if (typeof rawValue === "number") return String(rawValue);

    if (typeof rawValue === "string" && /^[a-z0-9-]{1,64}$/i.test(rawValue)) {
      return rawValue;
    }

    return "";
  }

  function mergeLinkedStreamDocuments(
    parentDocuments: TopicCompanionDocuments | null,
    linkedStream: ProbedStream,
  ): ProbedStream {
    if (parentDocuments && linkedStream.documents) {
      const noteSourceUrl = linkedStream.sourceUrl || "";

      const secondaryAsExtraNote = {
        title: linkedStream.linkedTitle || "Post",
        ...(noteSourceUrl ? { sourceUrl: noteSourceUrl } : {}),
      };

      const merged = mergeTopicCompanionDocuments(
        parentDocuments,
        linkedStream.documents,
        { secondaryAsExtraNote },
      );

      return merged
        ? Object.freeze({ ...linkedStream, documents: merged })
        : linkedStream;
    }

    const combined = parentDocuments || linkedStream.documents || null;

    return combined
      ? Object.freeze({ ...linkedStream, documents: combined })
      : linkedStream;
  }

  function nestedTopicField(payload: unknown, field: string): unknown {
    if (!isObjectRecord(payload)) return null;

    const item = isObjectRecord(payload.lesson) ? payload.lesson : null;
    const post = isObjectRecord(payload.post) ? payload.post : null;

    return payload[field] ?? item?.[field] ?? post?.[field] ?? null;
  }

  function collectSupplementaryLinkedPostUrls(
    payload: unknown,
    fallbackPageUrl: string,
  ): string[] {
    const richText = extractRichTextField(payload);

    if (!richText) return [];

    return extractRichTextLinkedPostUrls(richText, fallbackPageUrl)
      .filter((url) => isSupplementaryLinkedPostUrl(url, fallbackPageUrl))
      .filter((url, index, all) => all.indexOf(url) === index)
      .slice(0, 5);
  }

  function cacheExtractedStream(
    topicId: string,
    media: ExtractedMedia,
    documents: TopicCompanionDocuments | null,
    linkedUrls: readonly string[] = [],
  ): ProbedStream {
    const stream = Object.freeze({
      url: "",
      mediaUrl: media.mediaUrl,
      subtitles: media.subtitles,
      ...(documents ? { documents } : {}),
      ...(linkedUrls.length
        ? { linkedUrls: Object.freeze([...linkedUrls]) }
        : {}),
    });

    cachedStreamsById.set(topicId, stream);

    return stream;
  }

  function indexTopicRecord(
    record: Record<string, unknown>,
    id: string,
    rawTitle: string,
    topicSectionId: string,
    topicSectionTitle = "",
  ): void {
    const media = extractMediaFromJson(record);
    const key = normalizeTopicTitleKey(rawTitle);

    const sectionKey = topicSectionTitle
      ? normalizeTopicTitleKey(topicSectionTitle)
      : "";

    const entry = Object.freeze({
      id,
      sectionId: topicSectionId,
      sectionTitle: topicSectionTitle,
      title: rawTitle,
      mediaUrl: media.mediaUrl,
      subtitles: media.subtitles,
    });

    if (key && (!knownTopicsByTitle.has(key) || media.mediaUrl)) {
      knownTopicsByTitle.set(key, entry);
    }

    if (sectionKey && key) {
      const compositeKey = `${sectionKey}::${key}`;

      if (!knownTopicsBySectionAndTitle.has(compositeKey) || media.mediaUrl) {
        knownTopicsBySectionAndTitle.set(compositeKey, entry);
      }
    }

    if (!knownTopicsById.has(id) || media.mediaUrl) {
      knownTopicsById.set(id, entry);
    }

    if (media.mediaUrl) {
      cacheExtractedStream(
        id,
        media,
        extractDocumentsFromPayload(record, rawTitle, location.href),
        collectSupplementaryLinkedPostUrls(record, location.href),
      );
    }
  }

  function processTopicCandidateRecord(
    record: Record<string, unknown>,
    inheritedSectionId: string,
    inheritedSectionTitle: string,
    stack: TopicStackEntry[],
  ): void {
    const id = validIdentifierString(
      record.id ?? record.item_id ?? record.topicId,
    );

    const rawTitle = firstStringField(record, [
      "name",
      "title",
      "titulo",
      "nome",
    ]);

    const topicSectionId =
      validIdentifierString(
        record.section_id ??
          record.sectionId ??
          record.track_section_id ??
          record.capitulo_id,
      ) || inheritedSectionId;

    const nestedTopics =
      record.lessons ||
      record.course_lessons ||
      record.conteudos ||
      record.aulas ||
      record.items;

    if (Array.isArray(nestedTopics) && id) {
      const childSectionTitle = rawTitle || inheritedSectionTitle;

      for (const child of nestedTopics) {
        stack.push({
          node: child,
          sectionId: id,
          sectionTitle: childSectionTitle,
        });
      }
    }

    const hasMarker =
      Boolean(inheritedSectionId) ||
      ITEM_MARKER_KEYS.some((marker) => marker in record);

    if (id && rawTitle && !Array.isArray(nestedTopics) && hasMarker) {
      indexTopicRecord(
        record,
        id,
        rawTitle,
        topicSectionId,
        inheritedSectionTitle,
      );
    }

    for (const [key, value] of Object.entries(record)) {
      if (
        value &&
        typeof value === "object" &&
        !["lessons", "course_lessons", "items"].includes(key)
      ) {
        stack.push({
          node: value,
          sectionId: inheritedSectionId,
          sectionTitle: inheritedSectionTitle,
        });
      }
    }
  }

  /**
   * Indexes item objects (id, optional sectionId, title, and any embedded
   * media URLs) observed inside playlist JSON payloads or mounted props.
   */
  function extractTopicsFromJson(root: unknown): void {
    const stack: TopicStackEntry[] = [
      { node: root, sectionId: "", sectionTitle: "" },
    ];

    const cursor = { visited: 0 };

    while (stack.length && cursor.visited < 6000) {
      cursor.visited += 1;
      const item = stack.pop();

      if (!item?.node || typeof item.node !== "object") continue;

      if (Array.isArray(item.node)) {
        for (const element of [...item.node].reverse()) {
          stack.push({
            node: element,
            sectionId: item.sectionId,
            sectionTitle: item.sectionTitle,
          });
        }

        continue;
      }

      processTopicCandidateRecord(
        item.node as Record<string, unknown>,
        item.sectionId,
        item.sectionTitle,
        stack,
      );
    }
  }

  function scanDomPropsOnce(): void {
    if (observedState.scannedDomProps) return;
    observedState.scannedDomProps = true;

    for (const element of document.querySelectorAll("[data-props]")) {
      const raw = element.getAttribute("data-props");

      if (!raw || raw.length > 4_000_000) continue;
      const parsed = tryParseJson(raw);

      if (parsed) extractTopicsFromJson(parsed);
    }
  }

  function emitObservedMediaTracks(media: ExtractedMedia): void {
    if (media.subtitles.length > 0) {
      window.postMessage(
        {
          source: "opfs-media-packager",
          type: "page-subtitle-tracks",
          tracks: media.subtitles,
        },
        location.origin,
      );
    }

    if (media.mediaUrl) {
      emitCurrentTrackStream({ url: "", mediaUrl: media.mediaUrl });
    }
  }

  function emitPageTopicDocuments(documents: TopicCompanionDocuments): void {
    if (!countTopicCompanionDocuments(documents)) return;

    window.postMessage(
      {
        source: "opfs-media-packager",
        type: "page-topic-documents",
        documents,
      },
      location.origin,
    );
  }

  function buildSpaceSectionOutlineTopics(
    slug: string,
    rootFolder: string,
    sections: readonly unknown[],
  ): readonly {
    readonly id: string;
    readonly url: string;
    readonly fileTitle: string;
    readonly folderPath: readonly string[];
  }[] {
    const items: {
      readonly id: string;
      readonly url: string;
      readonly fileTitle: string;
      readonly folderPath: readonly string[];
    }[] = [];

    const seenIds = new Set<string>();
    const sectionCounter = { number: 0 };

    for (const rawSection of sections) {
      const section = isObjectRecord(rawSection) ? rawSection : null;
      const sectionId = validIdentifierString(section?.id);
      const rawLessons = section?.lessons;

      if (!section || !sectionId || !Array.isArray(rawLessons)) continue;

      sectionCounter.number += 1;

      const sectionTitle =
        firstStringField(section, ["name", "title"]) ||
        `Section ${sectionCounter.number}`;

      const topicCounter = { number: 0 };

      for (const rawLesson of rawLessons) {
        const lesson = isObjectRecord(rawLesson) ? rawLesson : null;
        const lessonId = validIdentifierString(lesson?.id);

        if (!lesson || !lessonId || seenIds.has(lessonId)) continue;

        seenIds.add(lessonId);
        topicCounter.number += 1;

        const lessonTitle =
          firstStringField(lesson, ["name", "title"]) ||
          `Item ${topicCounter.number}`;

        const lessonUrl = new URL(
          `/c/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/lessons/${encodeURIComponent(lessonId)}`,
          location.origin,
        ).href;

        items.push(
          Object.freeze({
            id: lessonId,
            url: lessonUrl,
            fileTitle: `${sectionCounter.number}.${topicCounter.number} ${lessonTitle}`,
            folderPath: Object.freeze([
              rootFolder,
              `${sectionCounter.number}. ${sectionTitle}`,
            ]),
          }),
        );
      }
    }

    return Object.freeze(items);
  }

  function maybePublishSpaceOutline(parsed: unknown): void {
    if (!isObjectRecord(parsed) || !Array.isArray(parsed.course_sections)) {
      return;
    }

    const route = sidebarRoutePath.exec(location.pathname);
    const spaceSlug = firstStringField(parsed, ["slug"]);

    if (
      !route ||
      !spaceSlug ||
      spaceSlug.toLowerCase() !== route[1].toLowerCase()
    ) {
      return;
    }

    const spaceId = validIdentifierString(parsed.id);

    if (spaceId) observedState.spaceId = spaceId;

    const trackTitle = firstStringField(parsed, ["name", "title"]) || spaceSlug;

    const rootFolder = trackRootFolderName(trackTitle, location.href);

    const items = buildSpaceSectionOutlineTopics(
      route[1],
      rootFolder,
      parsed.course_sections,
    );

    if (!items.length) return;

    const outline = Object.freeze({ title: trackTitle, items });
    const fingerprint = JSON.stringify(outline);

    if (fingerprint === observedState.publishedSpaceOutlineFingerprint) return;

    observedState.publishedSpaceOutlineFingerprint = fingerprint;

    window.postMessage(
      {
        source: "opfs-media-packager",
        type: "track-outline",
        outline,
      },
      location.origin,
    );
  }

  function observeSpaceAndFilesMetadata(
    resolved: URL | null,
    parsed: unknown,
    currentTopicId: string,
  ): void {
    maybePublishSpaceOutline(parsed);

    if (!resolved) return;

    const courseSpaceMatch = /\/internal_api\/courses\/(\d+)\//i.exec(
      resolved.pathname,
    );

    if (courseSpaceMatch) observedState.spaceId = courseSpaceMatch[1];

    const filesMatch =
      /\/internal_api\/courses\/(\d+)\/lessons\/(\d+)\/files\b/i.exec(
        resolved.pathname,
      );

    if (!filesMatch) return;

    const fileTopicId = filesMatch[2];
    const extracted = extractTopicFileAttachments(parsed, location.href);

    if (!countTopicCompanionDocuments(extracted)) return;

    const mergedFiles = mergeTopicCompanionDocuments(
      cachedFileAttachmentsByTopicId.get(fileTopicId),
      extracted,
    );

    if (!mergedFiles) return;

    cachedFileAttachmentsByTopicId.set(fileTopicId, mergedFiles);

    if (fileTopicId !== currentTopicId) return;

    const combined = mergeTopicCompanionDocuments(
      cachedTopicDocumentsByTopicId.get(currentTopicId),
      mergedFiles,
    );

    if (combined) emitPageTopicDocuments(combined);
  }

  function observeCurrentGenericTopic(
    resolved: URL,
    parsed: unknown,
    currentTopicId: string,
    currentSectionId: string,
    headers: Readonly<Record<string, string>>,
    withCredentials: boolean,
  ): void {
    const media = extractMediaFromJson(parsed);
    const embeddedVideo = extractFeaturedMediaEmbed(parsed, location.href);

    const embedUrl = embeddedVideo
      ? normalizeEmbedPlayerUrl(embeddedVideo.url)
      : null;

    if (!media.mediaUrl && !embedUrl && !looksLikeGenericTopicPayload(parsed)) {
      return;
    }

    observedState.genericTopicTemplate = Object.freeze({
      url: resolved.href,
      topicId: currentTopicId,
      sectionId:
        currentSectionId && resolved.href.includes(currentSectionId)
          ? currentSectionId
          : "",
      headers: Object.freeze({ ...headers }),
      withCredentials,
    });

    const cachedTitle = knownTopicsById.get(currentTopicId)?.title || "";

    const combinedDocuments =
      mergeTopicCompanionDocuments(
        extractDocumentsFromPayload(parsed, cachedTitle, location.href),
        cachedFileAttachmentsByTopicId.get(currentTopicId),
      ) ?? null;

    if (combinedDocuments) {
      cachedTopicDocumentsByTopicId.set(currentTopicId, combinedDocuments);
      emitPageTopicDocuments(combinedDocuments);
    }

    if (media.mediaUrl) {
      cacheExtractedStream(
        currentTopicId,
        media,
        combinedDocuments,
        collectSupplementaryLinkedPostUrls(parsed, location.href),
      );

      return;
    }

    if (embedUrl) {
      emitCurrentTrackStream({ url: "", mediaUrl: "", embedUrl });
    }
  }

  function inspectGenericJsonResponse(
    requestUrl: string,
    text: string,
    headers: Readonly<Record<string, string>>,
    withCredentials = true,
  ): void {
    if (!text || text.length > 4_000_000) return;
    const trimmed = text.trimStart();

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
    const parsed = tryParseJson(trimmed);

    if (!parsed) return;
    extractTopicsFromJson(parsed);
    const resolved = tryParseUrl(requestUrl);
    const route = sidebarRoutePath.exec(location.pathname);
    const queryTopicId = new URLSearchParams(location.search).get("conteudo");
    const currentSectionId = route?.[2] || "";
    const currentTopicId = route?.[3] || queryTopicId || "";

    observeSpaceAndFilesMetadata(resolved, parsed, currentTopicId);

    if (
      resolved &&
      /\/internal_api\/(?:media_settings|media_transcripts|spaces\/\d+\/posts\/|post_details)\b/i.test(
        resolved.pathname,
      )
    ) {
      emitObservedMediaTracks(extractMediaFromJson(parsed));
    }

    if (
      !currentTopicId ||
      !resolved ||
      !resolved.href.includes(currentTopicId)
    ) {
      return;
    }

    if (isObjectRecord(parsed) && typeof parsed.content === "string") {
      decodeApiTrackEnvelope(text, currentTopicId)
        .then(({ validEnvelope, stream }) => {
          if (!validEnvelope) return;

          observedState.apiTrackTemplate = Object.freeze({
            url: resolved.href,
            headers: Object.freeze({ ...headers }),
            withCredentials,
            topicIdToken: currentTopicId,
          });

          if (stream) emitCurrentTrackStream(stream);
        })
        .catch(() => {});

      return;
    }

    observeCurrentGenericTopic(
      resolved,
      parsed,
      currentTopicId,
      currentSectionId,
      headers,
      withCredentials,
    );
  }

  function looksLikeDirectVideoAddress(url: string): boolean {
    if (!isSafeHttpsUrl(url)) return false;
    const parsed = tryParseUrl(url);

    if (!parsed) return false;

    return (
      /\.m3u8?(?:$|[?#])/i.test(parsed.pathname) ||
      /\/hls(?:\/|$)/i.test(parsed.pathname) ||
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i.test(
        parsed.pathname,
      ) ||
      videoPlayerHostPattern.test(parsed.hostname)
    );
  }

  async function decodeApiTrackEnvelope(
    text: string,
    topicId?: string,
  ): Promise<DecodedEnvelopeResult> {
    try {
      const envelope: unknown = JSON.parse(text);

      const encoded =
        isObjectRecord(envelope) && typeof envelope.content === "string"
          ? envelope.content
          : "";

      if (!encoded || typeof DecompressionStream === "undefined") {
        return Object.freeze({ validEnvelope: false, stream: null });
      }

      const bytes = Uint8Array.from(atob(encoded), (character) =>
        character.charCodeAt(0),
      );

      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("deflate"));

      const value: unknown = JSON.parse(await new Response(stream).text());

      if (!isObjectRecord(value)) {
        return Object.freeze({ validEnvelope: false, stream: null });
      }

      const rawUrl = typeof value.url === "string" ? value.url : "";
      const extracted = extractMediaFromJson(value);
      const mediaUrl = embeddedMediaUrl(value) || extracted.mediaUrl;

      const isKnownVideoType =
        typeof value.tipo === "number" && [7, 12].includes(value.tipo);

      const url =
        isKnownVideoType || looksLikeDirectVideoAddress(rawUrl) ? rawUrl : "";

      if (!url && !mediaUrl) {
        return Object.freeze({ validEnvelope: true, stream: null });
      }

      const decoded: ProbedStream = Object.freeze({
        url,
        mediaUrl,
        subtitles: extracted.subtitles,
      });

      if (topicId) cachedStreamsById.set(topicId, decoded);

      return Object.freeze({ validEnvelope: true, stream: decoded });
    } catch {
      return Object.freeze({ validEnvelope: false, stream: null });
    }
  }

  function emitCurrentTrackStream(
    stream: Pick<ProbedStream, "url" | "mediaUrl" | "embedUrl">,
  ): void {
    if (!stream.url && !stream.mediaUrl && !stream.embedUrl) return;

    window.postMessage(
      {
        source: "opfs-media-packager",
        type: "track-stream",
        stream: {
          url: stream.url,
          mediaUrl: stream.mediaUrl,
          ...(stream.embedUrl ? { embedUrl: stream.embedUrl } : {}),
        },
      },
      location.origin,
    );
  }

  async function inspectApiTrackResponse(
    text: string,
    topicId?: string,
  ): Promise<void> {
    const { stream } = await decodeApiTrackEnvelope(text, topicId);

    if (stream) emitCurrentTrackStream(stream);
  }

  function toBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000;
    const chunkCount = Math.ceil(bytes.length / chunkSize);

    const chunks = Array.from({ length: chunkCount }, (_slot, chunkIndex) => {
      const start = chunkIndex * chunkSize;

      return String.fromCharCode(...bytes.subarray(start, start + chunkSize));
    });

    return btoa(chunks.join(""));
  }

  function copyHeaders(
    source: HeadersInit | undefined,
  ): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};

    if (!source) return Object.freeze(out);

    try {
      new Headers(source).forEach((value, key) => {
        out[key] = value;
      });
    } catch {
      // Ignore non-standard header shapes.
    }

    return Object.freeze(out);
  }

  function resolveTopicId(
    item: Pick<ProbeTopicInput, "id" | "title" | "sectionTitle" | "url">,
    currentTopicId: string,
  ): string {
    if (item.id === "current-topic") return currentTopicId;
    if (/^\d+$/.test(item.id)) return item.id;
    const byTitle = lookupKnownTopic(item.title, item.sectionTitle);

    if (byTitle?.id) return byTitle.id;
    const parsedUrl = tryParseUrl(item.url);

    const fromUrl = parsedUrl
      ? sidebarRoutePath.exec(parsedUrl.pathname)
      : null;

    if (fromUrl?.[3] && item.url !== location.href) return fromUrl[3];

    return "";
  }

  function resolveCandidatePageUrl(
    item: Pick<ProbeTopicInput, "url">,
    route: RegExpExecArray | null,
    topicId: string,
    sectionId: string,
  ): string {
    if (item.url && item.url !== location.href) {
      const parsed = tryParseUrl(item.url);

      return parsed && parsed.origin === location.origin ? parsed.href : "";
    }

    if (!route || !topicId || !sectionId) return "";

    return new URL(
      `/c/${route[1]}/sections/${encodeURIComponent(sectionId)}/lessons/${encodeURIComponent(topicId)}`,
      location.origin,
    ).href;
  }

  function scanPerformanceResourcesOnce(): void {
    if (observedState.scannedPerformanceResources) return;
    observedState.scannedPerformanceResources = true;

    if (
      observedState.apiTrackTemplate ||
      typeof performance?.getEntriesByType !== "function"
    ) {
      return;
    }

    const entry = performance
      .getEntriesByType("resource")
      .find((item) => apiContentPath.test(item.name || ""));

    if (!entry?.name) return;

    observedState.apiTrackTemplate = Object.freeze({
      url: entry.name,
      headers: Object.freeze({}),
      withCredentials: false,
    });
  }

  function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Reserves the next polite request timestamp on the current origin so
   * sequential or concurrent workers never send bursts to rate-limited sites.
   */
  async function waitForOriginPaceSlot(minIntervalMs: number): Promise<void> {
    const now = Date.now();

    const earliest = Math.max(
      now,
      originRateLimiter.nextSlotAt,
      originRateLimiter.blockedUntil,
    );

    originRateLimiter.nextSlotAt = earliest + minIntervalMs;
    const waitDuration = earliest - now;

    if (waitDuration > 0) await waitMs(waitDuration);
  }

  /**
   * Parses an HTTP Retry-After header (seconds or HTTP-date) into bounded
   * milliseconds, defaulting to a conservative cooldown when omitted.
   */
  function retryAfterDelayMs(response: Response): number {
    const raw = response.headers?.get?.("retry-after")?.trim() || "";

    if (!raw) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    const seconds = Number(raw);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(
        MAX_RATE_LIMIT_COOLDOWN_MS,
        Math.max(1500, Math.round(seconds * 1000)),
      );
    }

    const parsedDate = Date.parse(raw);

    if (!Number.isNaN(parsedDate)) {
      return Math.min(
        MAX_RATE_LIMIT_COOLDOWN_MS,
        Math.max(1500, parsedDate - Date.now()),
      );
    }

    return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  }

  /**
   * Records a rate-limit response (HTTP 429/503). Allows at most one polite
   * retry after honoring Retry-After; trips the circuit breaker on repeated
   * throttling so the extension never hammers a rate-limited origin.
   */
  function recordOriginThrottle(response: Response): ThrottleDecision {
    originRateLimiter.consecutive429s += 1;
    const cooldownMs = retryAfterDelayMs(response);

    originRateLimiter.blockedUntil = Math.max(
      originRateLimiter.blockedUntil,
      Date.now() + cooldownMs,
    );

    if (originRateLimiter.consecutive429s >= 2) {
      originRateLimiter.tripped = true;

      return Object.freeze({ shouldRetry: false, cooldownMs });
    }

    return Object.freeze({ shouldRetry: true, cooldownMs });
  }

  /**
   * Executes a paced same-origin request with Retry-After backoff (1 polite
   * retry) and a 2-strike 429/503 circuit breaker shared across all playlist
   * adapters.
   */
  async function fetchOriginResponseWithBackoff(
    targetUrl: string,
    init: RequestInit,
    remainingAttempts = 2,
  ): Promise<OriginFetchOutcome> {
    if (originRateLimiter.tripped || remainingAttempts <= 0) {
      originRateLimiter.tripped = true;

      return Object.freeze({
        response: null,
        status: 429,
        rateLimited: true,
      });
    }

    await waitForOriginPaceSlot(API_PLAYLIST_PACE_MS);

    try {
      const response = await (nativeFetch || fetch)(targetUrl, init);

      if (response.status === 429 || response.status === 503) {
        const throttle = recordOriginThrottle(response);

        if (!throttle.shouldRetry) {
          return Object.freeze({
            response: null,
            status: response.status,
            rateLimited: true,
          });
        }

        return fetchOriginResponseWithBackoff(
          targetUrl,
          init,
          remainingAttempts - 1,
        );
      }

      if (response.ok) originRateLimiter.consecutive429s = 0;

      return Object.freeze({
        response: response.ok ? response : null,
        status: response.status,
        rateLimited: false,
      });
    } catch {
      return Object.freeze({
        response: null,
        status: 0,
        rateLimited: false,
      });
    }
  }

  async function fetchApiTrackWithBackoff(
    targetUrl: string,
    credentialsMode: RequestCredentials,
    headers: Readonly<Record<string, string>>,
    topicId: string,
  ): Promise<ApiTrackAttempt> {
    const outcome = await fetchOriginResponseWithBackoff(targetUrl, {
      cache: "no-store",
      credentials: credentialsMode,
      headers,
    });

    if (!outcome.response) {
      return Object.freeze({
        ok: false,
        status: outcome.status,
        rateLimited: outcome.rateLimited,
        stream: null,
      });
    }

    try {
      const decoded = await decodeApiTrackEnvelope(
        await outcome.response.text(),
        topicId,
      );

      return Object.freeze({
        ok: decoded.validEnvelope,
        status: outcome.status,
        rateLimited: false,
        stream: decoded.validEnvelope ? decoded.stream : null,
      });
    } catch {
      return Object.freeze({
        ok: false,
        status: 0,
        rateLimited: false,
        stream: null,
      });
    }
  }

  function apiTrackTargetUrl(
    template: Pick<ApiTrackTemplate, "url" | "topicIdToken"> | null,
    topicId: string,
  ): string {
    if (!template?.url) {
      return new URL(`/cursos/conteudo/${topicId}.json`, location.origin).href;
    }

    if (template.topicIdToken) {
      return template.url.replaceAll(
        template.topicIdToken,
        encodeURIComponent(topicId),
      );
    }

    return template.url.replace(
      /(cursos\/conteudo\/)\d+(\.json)/,
      `$1${topicId}$2`,
    );
  }

  async function probeViaApiTrackEndpoint(
    topicId: string,
  ): Promise<ApiTrackAttempt> {
    scanPerformanceResourcesOnce();
    const template = observedState.apiTrackTemplate;

    if (!template && observedState.defaultApiEndpointFailed) {
      return Object.freeze({ ok: false, status: 0, stream: null });
    }

    const targetUrl = apiTrackTargetUrl(template, topicId);
    const headers = template?.headers || {};

    const primaryMode: RequestCredentials = template?.withCredentials
      ? "include"
      : "same-origin";

    const firstAttempt = await fetchApiTrackWithBackoff(
      targetUrl,
      primaryMode,
      headers,
      topicId,
    );

    if (firstAttempt.ok) {
      if (!template) {
        observedState.apiTrackTemplate = Object.freeze({
          url: targetUrl,
          headers: Object.freeze({ ...headers }),
          withCredentials: primaryMode === "include",
        });
      }

      return firstAttempt;
    }

    const shouldRetryMode =
      !firstAttempt.rateLimited &&
      (firstAttempt.status === 0 ||
        firstAttempt.status === 401 ||
        firstAttempt.status === 403);

    const alternateMode: RequestCredentials =
      primaryMode === "include" ? "same-origin" : "include";

    const finalAttempt = shouldRetryMode
      ? await fetchApiTrackWithBackoff(
          targetUrl,
          alternateMode,
          headers,
          topicId,
        )
      : firstAttempt;

    if (finalAttempt.ok) {
      observedState.apiTrackTemplate = Object.freeze({
        url: template?.url || targetUrl,
        headers: Object.freeze({ ...headers }),
        withCredentials: alternateMode === "include",
        ...(template?.topicIdToken
          ? { topicIdToken: template.topicIdToken }
          : {}),
      });
    }

    if (!finalAttempt.ok && !finalAttempt.rateLimited && !template) {
      observedState.defaultApiEndpointFailed = true;
    }

    return finalAttempt;
  }

  function collectPayloadLinkedUrls(
    payload: unknown,
    fallbackPageUrl: string,
  ): string[] {
    const embedNode = nestedTopicField(payload, "featured_media_embed");
    const richText = extractRichTextField(payload);

    const embedUrls = embedNode
      ? extractLinkedUrlsFromJson(embedNode, fallbackPageUrl)
      : [];

    const bodyUrls = richText
      ? extractRichTextLinkedPostUrls(richText, fallbackPageUrl)
      : extractLinkedUrlsFromJson(payload, fallbackPageUrl);

    return [...embedUrls, ...bodyUrls]
      .filter((url, index, all) => all.indexOf(url) === index)
      .slice(0, 5);
  }

  function documentsOnlyStream(
    fallbackPageUrl: string,
    documents: TopicCompanionDocuments,
  ): ProbedStream {
    return Object.freeze({
      url: "",
      mediaUrl: "",
      subtitles: Object.freeze([]),
      sourceUrl: fallbackPageUrl,
      documents,
    });
  }

  function optionalDocumentsStream(
    fallbackPageUrl: string,
    documents: TopicCompanionDocuments | null,
  ): ProbedStream | null {
    return documents ? documentsOnlyStream(fallbackPageUrl, documents) : null;
  }

  async function fetchTopicFilesPage(
    spaceId: string,
    topicId: string,
    page: number,
    fallbackPageUrl: string,
    template: GenericTopicTemplate,
  ): Promise<{
    readonly documents: TopicCompanionDocuments | null;
    readonly hasMore: boolean;
    readonly rateLimited: boolean;
  }> {
    const filesUrl = new URL(
      `/internal_api/courses/${encodeURIComponent(spaceId)}/lessons/${encodeURIComponent(topicId)}/files?per_page=20&page=${page}`,
      location.origin,
    ).href;

    const outcome = await fetchOriginResponseWithBackoff(filesUrl, {
      cache: "no-store",
      credentials: template.withCredentials ? "include" : "omit",
      headers: template.headers,
    });

    if (outcome.rateLimited) {
      return { documents: null, hasMore: false, rateLimited: true };
    }

    if (!outcome.response) {
      return { documents: null, hasMore: false, rateLimited: false };
    }

    const parsed = tryParseJson(await outcome.response.text().catch(() => ""));

    if (!parsed) {
      return { documents: null, hasMore: false, rateLimited: false };
    }

    const extracted = extractTopicFileAttachments(parsed, fallbackPageUrl);

    return {
      documents: countTopicCompanionDocuments(extracted) > 0 ? extracted : null,
      hasMore: isObjectRecord(parsed) && parsed.has_next_page === true,
      rateLimited: false,
    };
  }

  async function fetchTopicFileAttachments(
    topicId: string,
    fallbackPageUrl: string,
    template: GenericTopicTemplate,
  ): Promise<{
    readonly documents: TopicCompanionDocuments | null;
    readonly rateLimited: boolean;
  }> {
    const cached = cachedFileAttachmentsByTopicId.get(topicId);

    if (cached) return { documents: cached, rateLimited: false };

    const templateSpaceMatch = /\/internal_api\/courses\/(\d+)\//i.exec(
      template.url,
    );

    const spaceId = observedState.spaceId || templateSpaceMatch?.[1] || "";

    if (!spaceId || !/^\d+$/.test(topicId)) {
      return { documents: null, rateLimited: false };
    }

    const pageState: {
      page: number;
      hasMore: boolean;
      merged: TopicCompanionDocuments | undefined;
    } = { page: 1, hasMore: true, merged: undefined };

    while (pageState.hasMore && pageState.page <= 5) {
      const pageResult = await fetchTopicFilesPage(
        spaceId,
        topicId,
        pageState.page,
        fallbackPageUrl,
        template,
      );

      if (pageResult.rateLimited) return { documents: null, rateLimited: true };

      if (pageResult.documents) {
        pageState.merged = mergeTopicCompanionDocuments(
          pageState.merged,
          pageResult.documents,
        );
      }

      pageState.hasMore = pageResult.hasMore;
      pageState.page += 1;
    }

    if (pageState.merged) {
      cachedFileAttachmentsByTopicId.set(topicId, pageState.merged);
    }

    return { documents: pageState.merged ?? null, rateLimited: false };
  }

  function resolveEmbedTopicProbeResult(
    topicId: string,
    payload: unknown,
    media: ExtractedMedia,
    documents: TopicCompanionDocuments | null,
    fallbackPageUrl: string,
  ): HeadlessProbeResult | null {
    const embeddedVideo = extractFeaturedMediaEmbed(payload, fallbackPageUrl);

    const embedUrl = embeddedVideo
      ? normalizeEmbedPlayerUrl(embeddedVideo.url)
      : null;

    if (!embedUrl) return null;

    const stream: ProbedStream = Object.freeze({
      url: "",
      mediaUrl: "",
      embedUrl,
      subtitles: media.subtitles,
      sourceUrl: fallbackPageUrl,
      ...(documents ? { documents } : {}),
    });

    cachedStreamsById.set(topicId, stream);

    return Object.freeze({ checked: true, stream, linkedUrl: "" });
  }

  async function resolveLinkedUrlsProbeResult(
    topicId: string,
    linkedUrls: readonly string[],
    documents: TopicCompanionDocuments | null,
    fallbackPageUrl: string,
  ): Promise<HeadlessProbeResult | null> {
    if (linkedUrls.length > 1) {
      return Object.freeze({
        checked: false,
        stream: optionalDocumentsStream(fallbackPageUrl, documents),
        linkedUrl: linkedUrls[0],
        linkedUrls: Object.freeze(linkedUrls),
      });
    }

    if (linkedUrls.length !== 1) return null;

    const linked = await resolveLinkedVideoHeadless(linkedUrls);

    if (linked.rateLimited) return RATE_LIMITED_PROBE_RESULT;

    if (linked.stream) {
      const stream = mergeLinkedStreamDocuments(documents, linked.stream);

      cachedStreamsById.set(topicId, stream);

      return Object.freeze({ checked: true, stream, linkedUrl: "" });
    }

    if (linked.fallbackUrl) {
      return Object.freeze({
        checked: false,
        stream: optionalDocumentsStream(fallbackPageUrl, documents),
        linkedUrl: linked.fallbackUrl,
        linkedUrls: Object.freeze([linked.fallbackUrl]),
      });
    }

    return null;
  }

  async function probeViaGenericTopicApi(
    topicId: string,
    sectionId: string,
    fallbackPageUrl: string,
    topicTitle = "",
  ): Promise<HeadlessProbeResult | null> {
    const template = observedState.genericTopicTemplate;

    if (!template || !topicId) return null;

    const fetched = await fetchGenericTopicPayload(
      template,
      topicId,
      sectionId,
    );

    if (fetched.rateLimited) return RATE_LIMITED_PROBE_RESULT;
    if (!fetched.payload) return null;
    const media = extractMediaFromJson(fetched.payload);

    const filesOutcome = await fetchTopicFileAttachments(
      topicId,
      fallbackPageUrl,
      template,
    );

    if (filesOutcome.rateLimited) return RATE_LIMITED_PROBE_RESULT;

    const documents =
      mergeTopicCompanionDocuments(
        extractDocumentsFromPayload(
          fetched.payload,
          topicTitle,
          fallbackPageUrl,
        ),
        filesOutcome.documents,
      ) ?? null;

    if (media.mediaUrl) {
      const supplementaryLinks = collectSupplementaryLinkedPostUrls(
        fetched.payload,
        fallbackPageUrl,
      );

      const stream = cacheExtractedStream(
        topicId,
        media,
        documents,
        supplementaryLinks,
      );

      if (supplementaryLinks.length > 0) {
        return Object.freeze({
          checked: false,
          stream: Object.freeze({ ...stream, sourceUrl: fallbackPageUrl }),
          linkedUrl: supplementaryLinks[0],
          linkedUrls: Object.freeze(supplementaryLinks),
        });
      }

      return Object.freeze({ checked: true, stream, linkedUrl: "" });
    }

    const embedResult = resolveEmbedTopicProbeResult(
      topicId,
      fetched.payload,
      media,
      documents,
      fallbackPageUrl,
    );

    if (embedResult) return embedResult;

    const linkedResult = await resolveLinkedUrlsProbeResult(
      topicId,
      collectPayloadLinkedUrls(fetched.payload, fallbackPageUrl),
      documents,
      fallbackPageUrl,
    );

    if (linkedResult) return linkedResult;

    if (documents) {
      const stream = documentsOnlyStream(fallbackPageUrl, documents);

      cachedStreamsById.set(topicId, stream);

      return Object.freeze({ checked: true, stream, linkedUrl: "" });
    }

    return Object.freeze({ checked: true, stream: null, linkedUrl: "" });
  }

  function toLinkedProbeResult<T extends HeadlessProbeResult | null>(
    linked: LinkedVideoResolution,
    fallback: T,
  ): HeadlessProbeResult | T {
    if (linked.rateLimited) return RATE_LIMITED_PROBE_RESULT;

    if (linked.stream) {
      return Object.freeze({
        checked: true,
        stream: linked.stream,
        linkedUrl: "",
      });
    }

    if (linked.fallbackUrl) {
      return Object.freeze({
        checked: false,
        stream: null,
        linkedUrl: linked.fallbackUrl,
      });
    }

    return fallback;
  }

  async function probeViaTopicPageHtml(
    candidatePageUrl: string,
  ): Promise<HeadlessProbeResult | null> {
    if (!candidatePageUrl) return null;

    const outcome = await fetchOriginResponseWithBackoff(candidatePageUrl, {
      cache: "no-store",
      credentials: "include",
    });

    if (outcome.rateLimited) return RATE_LIMITED_PROBE_RESULT;
    if (!outcome.response) return null;

    try {
      const rawHtml = await outcome.response.text();
      const html = decodeHtmlEntities(rawHtml);

      const playlists = [...html.matchAll(m3u8Pattern)]
        .map((match) => cleanCandidateUrl(match[0]))
        .filter(isSafeHttpsUrl)
        .sort(
          (left, right) => scorePlaylistUrl(right) - scorePlaylistUrl(left),
        );

      if (playlists.length) {
        const subtitles = [...html.matchAll(subtitlePattern)]
          .map((match) => cleanCandidateUrl(match[0]))
          .filter((url) => isSafeHttpsUrl(url) && !isStoryboardSubtitleUrl(url))
          .slice(0, 10)
          .map((url) => Object.freeze({ url, language: "", label: "" }));

        return Object.freeze({
          checked: true,
          stream: Object.freeze({
            url: "",
            mediaUrl: playlists[0],
            subtitles: Object.freeze(subtitles),
          }),
          linkedUrl: "",
        });
      }

      const linkedUrls = extractLinkedUrlsFromText(html, candidatePageUrl);

      if (!linkedUrls.length) return null;
      const linked = await resolveLinkedVideoHeadless(linkedUrls);

      return toLinkedProbeResult(linked, null);
    } catch {
      return null;
    }
  }

  function shouldSkipHtmlFallback(
    isApiTrack: boolean,
    topicId: string,
  ): boolean {
    return isApiTrack || Boolean(observedState.genericTopicTemplate && topicId);
  }

  function cachedProbeResult(cached: ProbedStream): HeadlessProbeResult {
    if (cached.linkedUrls?.length) {
      return Object.freeze({
        checked: false,
        stream: cached,
        linkedUrl: cached.linkedUrls[0],
        linkedUrls: cached.linkedUrls,
      });
    }

    return Object.freeze({
      checked: true,
      stream:
        cached.url || cached.mediaUrl || cached.embedUrl || cached.documents
          ? cached
          : null,
      linkedUrl: "",
    });
  }

  /**
   * Resolves one item's stream headlessly using cached data, observed playlist
   * API templates, or same-origin HTML fetch.
   */
  async function probeSingleTopicHeadless(
    item: ProbeTopicInput,
  ): Promise<HeadlessProbeResult> {
    scanDomPropsOnce();
    const route = sidebarRoutePath.exec(location.pathname);
    const topicId = resolveTopicId(item, route?.[3] || "");

    const knownByTitle = lookupKnownTopic(item.title, item.sectionTitle);

    const knownById = topicId ? knownTopicsById.get(topicId) : null;

    const sectionId =
      knownById?.sectionId || knownByTitle?.sectionId || route?.[2] || "";

    const cached = topicId ? cachedStreamsById.get(topicId) : undefined;

    if (cached) return cachedProbeResult(cached);

    if (originRateLimiter.tripped) return RATE_LIMITED_PROBE_RESULT;

    const isApiTrack = /\/courses\//i.test(location.pathname);

    if (isApiTrack && /^\d+$/.test(topicId)) {
      const apiResult = await probeViaApiTrackEndpoint(topicId);

      if (apiResult.rateLimited) return RATE_LIMITED_PROBE_RESULT;

      if (apiResult.ok) {
        return Object.freeze({
          checked: true,
          stream: apiResult.stream,
          linkedUrl: "",
          rateLimited: false,
        });
      }
    }

    const fallbackPageUrl =
      resolveCandidatePageUrl(item, route, topicId, sectionId) ||
      item.url ||
      location.href;

    const viaGeneric = await probeViaGenericTopicApi(
      topicId,
      sectionId,
      fallbackPageUrl,
      item.title,
    );

    if (viaGeneric) return viaGeneric;

    // Client-rendered SPAs with an active item API template never embed HLS
    // URLs in shell HTML; skipping HTML fetches avoids doubling origin requests
    // under rate limits.
    if (shouldSkipHtmlFallback(isApiTrack, topicId)) {
      return Object.freeze({
        checked: false,
        stream: null,
        linkedUrl: "",
        rateLimited: false,
      });
    }

    const candidatePageUrl = resolveCandidatePageUrl(
      item,
      route,
      topicId,
      sectionId,
    );

    const viaHtml = await probeViaTopicPageHtml(candidatePageUrl);

    if (viaHtml) return viaHtml;

    return Object.freeze({
      checked: false,
      stream: null,
      linkedUrl: "",
      rateLimited: false,
    });
  }

  function emitUnresolvedProbeTopic(
    requestId: string,
    topicIndex: number,
    result: HeadlessProbeResult,
    unresolvedIndices: number[],
    unresolvedLinks: Record<string, string>,
    unresolvedLinkLists: Record<string, readonly string[]>,
  ): void {
    if (
      result.stream &&
      (result.stream.mediaUrl || result.stream.url || result.stream.documents)
    ) {
      window.postMessage(
        {
          source: "opfs-media-packager",
          type: "track-topic-probed",
          requestId,
          topicIndex,
          stream: result.stream,
          partial: true,
        },
        location.origin,
      );
    }

    unresolvedIndices.push(topicIndex);

    if (result.linkedUrl) {
      unresolvedLinks[String(topicIndex)] = result.linkedUrl;
    }

    if (result.linkedUrls?.length) {
      unresolvedLinkLists[String(topicIndex)] = result.linkedUrls;
    }
  }

  /**
   * Runs headless item probing with polite origin pacing and a 429 circuit
   * breaker, streaming each discovered item back immediately.
   */
  async function handleBatchProbe(
    requestId: string,
    items: readonly ProbeTopicInput[],
  ): Promise<void> {
    window.postMessage(
      {
        source: "opfs-media-packager",
        type: "probe-track-topics-ack",
        requestId,
      },
      location.origin,
    );

    originRateLimiter.tripped = false;
    originRateLimiter.consecutive429s = 0;
    const batchState = { rateLimited: false };
    const unresolvedIndices: number[] = [];
    const unresolvedLinks: Record<string, string> = {};
    const unresolvedLinkLists: Record<string, readonly string[]> = {};
    const queue = [...items];

    const workerCount = Math.min(
      API_PLAYLIST_CONCURRENCY,
      Math.max(items.length, 1),
    );

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !batchState.rateLimited) {
          const item = queue.shift();

          if (!item) break;
          const result = await probeSingleTopicHeadless(item);

          if (result.rateLimited) {
            batchState.rateLimited = true;
            unresolvedIndices.push(item.topicIndex);
            break;
          }

          if (!result.checked) {
            emitUnresolvedProbeTopic(
              requestId,
              item.topicIndex,
              result,
              unresolvedIndices,
              unresolvedLinks,
              unresolvedLinkLists,
            );

            continue;
          }

          window.postMessage(
            {
              source: "opfs-media-packager",
              type: "track-topic-probed",
              requestId,
              topicIndex: item.topicIndex,
              stream: result.stream,
            },
            location.origin,
          );
        }
      }),
    );

    if (batchState.rateLimited) {
      for (const skipped of queue) unresolvedIndices.push(skipped.topicIndex);
    }

    window.postMessage(
      {
        source: "opfs-media-packager",
        type: "track-topics-probe-done",
        requestId,
        unresolvedIndices,
        unresolvedLinks,
        unresolvedLinkLists,
        rateLimited: batchState.rateLimited,
      },
      location.origin,
    );
  }

  function isAllowedPageMediaPath(pathname: string): boolean {
    return (
      /\.m3u8?$/i.test(pathname) ||
      /\.(?:vtt|srt|ttml|dfxp)$/i.test(pathname) ||
      /^(?:\/internal_api)?\/media_transcripts\/\d+(?:\.vtt)?$/i.test(pathname)
    );
  }

  async function fetchMediaFromPage(
    url: string,
    responseType: "text" | "bytes",
  ): Promise<PageMediaResponse> {
    try {
      const remote = new URL(url);

      if (
        remote.protocol !== "https:" ||
        remote.username ||
        remote.password ||
        !isAllowedPageMediaPath(remote.pathname)
      ) {
        return Object.freeze({ status: 0, body: "" });
      }

      const externalInit: RequestInit = {
        cache: "no-store",
        credentials: "omit",
        referrer: location.href,
        referrerPolicy: "unsafe-url",
      };

      const fetchInit: RequestInit =
        remote.origin === location.origin
          ? { ...externalInit, credentials: "include" }
          : externalInit;

      const result = await (nativeFetch || fetch)(remote.href, fetchInit);

      const body =
        responseType === "text"
          ? await result.text()
          : toBase64(new Uint8Array(await result.arrayBuffer()));

      return Object.freeze({ status: result.status, body });
    } catch {
      return Object.freeze({ status: 0, body: "" });
    }
  }

  window.addEventListener("message", async (event: MessageEvent<unknown>) => {
    const request = isObjectRecord(event.data) ? event.data : null;

    if (
      event.source !== window ||
      event.origin !== location.origin ||
      request?.source !== "opfs-media-packager"
    ) {
      return;
    }

    if (
      request.type === "probe-track-topics" &&
      typeof request.requestId === "string" &&
      Array.isArray(request.items)
    ) {
      const requestId = request.requestId;
      const items = request.items as readonly ProbeTopicInput[];

      handleBatchProbe(requestId, items).catch(() => {
        window.postMessage(
          {
            source: "opfs-media-packager",
            type: "track-topics-probe-done",
            requestId,
            unresolvedIndices: items.map((item) => item.topicIndex),
            unresolvedLinks: {},
          },
          location.origin,
        );
      });

      return;
    }

    if (
      request.type !== "fetch-media" ||
      typeof request.requestId !== "string" ||
      typeof request.url !== "string" ||
      (request.responseType !== "text" && request.responseType !== "bytes")
    ) {
      return;
    }

    const response = await fetchMediaFromPage(
      request.url,
      request.responseType,
    );

    window.postMessage(
      {
        source: "opfs-media-packager",
        type: "fetch-media-result",
        requestId: request.requestId,
        response,
      },
      location.origin,
    );
  });

  // Observe XHR requests made by the playlist page.
  const open = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (
    this: TrackedXMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: [
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ]
  ): void {
    this.__hlsDirectSaverUrl = String(url);
    this.__hlsDirectSaverHeaders = {};
    Reflect.apply(open, this, [method, url, ...rest]);
  };

  const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (
    this: TrackedXMLHttpRequest,
    name: string,
    value: string,
  ): void {
    if (this.__hlsDirectSaverHeaders && typeof name === "string") {
      this.__hlsDirectSaverHeaders[name] = String(value);
    }

    setRequestHeader.call(this, name, value);
  };

  const send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.send = function (
    this: TrackedXMLHttpRequest,
    ...args: Parameters<typeof send>
  ): void {
    this.addEventListener(
      "loadend",
      () => {
        try {
          const requestUrl = this.__hlsDirectSaverUrl || "";

          const headers = Object.freeze({
            ...(this.__hlsDirectSaverHeaders || {}),
          });

          if (typeof this.responseText !== "string") return;
          const apiMatch = apiContentPath.exec(requestUrl);

          if (apiMatch) {
            const parsed = tryParseUrl(requestUrl);

            if (parsed) {
              observedState.apiTrackTemplate = Object.freeze({
                url: parsed.href,
                headers,
                withCredentials: Boolean(this.withCredentials),
              });
            }

            inspectApiTrackResponse(this.responseText, apiMatch[1]);

            return;
          }

          if (this.status >= 200 && this.status < 300) {
            inspectGenericJsonResponse(
              requestUrl,
              this.responseText,
              headers,
              Boolean(this.withCredentials),
            );
          }
        } catch {
          // Binary responses deliberately expose no responseText.
        }
      },
      { once: true },
    );

    send.apply(this, args);
  };

  function fetchInputUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;

    if (typeof Request !== "undefined" && input instanceof Request) {
      return input.url;
    }

    return "";
  }

  // Observe fetch() requests made by SPA playlist players.
  const originalFetch = window.fetch;

  if (typeof originalFetch === "function") {
    window.fetch = function (
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const requestUrl = fetchInputUrl(input);

      const requestHeaders =
        typeof Request !== "undefined" && input instanceof Request
          ? input.headers
          : undefined;

      const headers = copyHeaders(init?.headers || requestHeaders);
      const pending = originalFetch.call(this, input, init);

      pending
        .then((response) => {
          if (!response || !response.ok) return;
          const contentType = response.headers?.get("content-type") || "";
          const apiMatch = apiContentPath.exec(requestUrl);

          if (apiMatch) {
            const parsed = tryParseUrl(requestUrl);

            if (parsed) {
              observedState.apiTrackTemplate = Object.freeze({
                url: parsed.href,
                headers,
                withCredentials: true,
              });
            }

            response
              .clone()
              .text()
              .then((text) => inspectApiTrackResponse(text, apiMatch[1]))
              .catch(() => {});

            return;
          }

          if (contentType.includes("json")) {
            response
              .clone()
              .text()
              .then((text) =>
                inspectGenericJsonResponse(requestUrl, text, headers),
              )
              .catch(() => {});
          }
        })
        .catch(() => {});

      return pending;
    };
  }
})();
