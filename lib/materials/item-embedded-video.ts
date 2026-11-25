import { externalRecord } from "../security/external-values.ts";
import { safeMediaUrl } from "../security/security.ts";
import { sanitizeMarkdownText } from "./item-markdown.ts";
import { resolveSafeUrl, stringField } from "./item-asset-urls.ts";
import type {
  ItemCompanionDocuments,
  EmbeddedVideoLink,
} from "./item-assets.ts";

const YOUTUBE_EMBED_HOST_PATTERN = /(?:^|\.)youtube(?:-nocookie)?\.com$/i;

const YOUTUBE_EMBED_PATH_PATTERN = /^\/embed\/([A-Za-z0-9_-]{6,})/i;

function extractYouTubeVideoId(url: string): string {
  const parsed = new URL(url);

  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.split("/").filter(Boolean)[0] ?? "";
  }

  if (!YOUTUBE_EMBED_HOST_PATTERN.test(parsed.hostname)) return "";

  const embedMatch = YOUTUBE_EMBED_PATH_PATTERN.exec(parsed.pathname);

  if (embedMatch) return embedMatch[1];

  return parsed.searchParams.get("v") ?? "";
}

/**
 * Normalizes embedded player URLs (converting YouTube `/embed/<id>` URLs into
 * canonical `watch?v=<id>` links) after validating HTTP(S) safety.
 */
export function normalizeEmbeddedVideoUrl(
  rawUrl: string,
  pageUrl: string,
): string | null {
  const resolved = resolveSafeUrl(rawUrl, pageUrl);

  if (!resolved) return null;

  const parsed = new URL(resolved);

  if (YOUTUBE_EMBED_HOST_PATTERN.test(parsed.hostname)) {
    const match = YOUTUBE_EMBED_PATH_PATTERN.exec(parsed.pathname);

    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  }

  return resolved;
}

/**
 * Extracts an external embedded video URL and title from `featured_media_embed`
 * on a item or post payload, normalizing iframe/embed URLs when needed.
 */
export function extractFeaturedMediaEmbed(
  payload: unknown,
  pageUrl: string,
): { readonly url: string; readonly title: string } | null {
  const root = externalRecord(payload);

  if (!root) return null;

  const item = externalRecord(root.lesson);
  const post = externalRecord(root.post);

  const embed =
    externalRecord(root.featured_media_embed) ??
    externalRecord(item?.featured_media_embed) ??
    externalRecord(post?.featured_media_embed);

  if (!embed) return null;

  const htmlText = stringField(embed.html);

  const iframeSrc = htmlText
    ? (/<iframe[^>]+src=["']([^"']+)["']/i.exec(htmlText)?.[1] ?? "")
    : "";

  const url = normalizeEmbeddedVideoUrl(
    stringField(embed.content) || iframeSrc,
    pageUrl,
  );

  if (!url) return null;

  return Object.freeze({ url, title: stringField(embed.title) });
}

function markdownContainsVideoLink(markdown: string, url: string): boolean {
  if (markdown.includes(url)) return true;

  const videoId = extractYouTubeVideoId(url);

  if (!videoId) return false;

  return (
    markdown.includes(`v=${videoId}`) ||
    markdown.includes(`youtu.be/${videoId}`) ||
    markdown.includes(`/embed/${videoId}`)
  );
}

function formatNonEmptyMarkdownWithVideo(
  current: string,
  videoLine: string,
  fallbackTitle: string,
): string {
  const firstNewline = current.indexOf("\n");

  if (current.startsWith("# ") && firstNewline >= 0) {
    const heading = current.slice(0, firstNewline);
    const rest = current.slice(firstNewline).replace(/^\n+/, "");

    return `${heading}\n\n${videoLine}\n\n${rest}\n`;
  }

  if (current.startsWith("# ")) return `${current}\n\n${videoLine}\n`;

  const cleanTitle = sanitizeMarkdownText(fallbackTitle).trim();
  const header = cleanTitle ? `# ${cleanTitle}\n\n` : "";

  return `${header}${videoLine}\n\n${current}\n`;
}

function formatEmptyMarkdownWithVideo(
  videoLine: string,
  cleanFallback: string,
): string {
  return cleanFallback
    ? `# ${cleanFallback}\n\n${videoLine}\n`
    : `${videoLine}\n`;
}

/**
 * Ensures an embedded external video (such as a YouTube item player) is
 * included in the item's Markdown note without duplicating an existing link.
 */
export function withEmbeddedVideoMarkdown(
  documents: ItemCompanionDocuments,
  embeddedVideo: EmbeddedVideoLink | null | undefined,
  fallbackTitle?: string,
): ItemCompanionDocuments {
  const safeUrl = embeddedVideo?.url ? safeMediaUrl(embeddedVideo.url) : null;

  if (!safeUrl || markdownContainsVideoLink(documents.markdown, safeUrl)) {
    return documents;
  }

  const linkTitle =
    sanitizeMarkdownText(embeddedVideo?.title ?? "").trim() || safeUrl;

  const videoLine = `**Vídeo:** [${linkTitle}](${safeUrl})`;
  const current = documents.markdown.trimEnd();
  const cleanFallback = sanitizeMarkdownText(fallbackTitle ?? "").trim();

  const markdown = current
    ? formatNonEmptyMarkdownWithVideo(current, videoLine, cleanFallback)
    : formatEmptyMarkdownWithVideo(videoLine, cleanFallback);

  return Object.freeze({ ...documents, markdown });
}
