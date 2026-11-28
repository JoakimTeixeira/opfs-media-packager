import type { TopicFileAssetKind } from "./topic-assets.ts";

export interface DownloadedArtifactAnnotation {
  readonly kind: TopicFileAssetKind | "diagram" | "slides" | "note" | "video";
  readonly url: string;
  readonly fallbackUrl?: string;
  readonly filename: string;
  readonly alreadyDownloaded?: boolean;
  readonly folderLabel?: string;
}

interface AnnotationEntry {
  readonly artifact: DownloadedArtifactAnnotation;
  matchedInline: boolean;
}

const ARTIFACT_KIND_LABELS: Readonly<
  Record<DownloadedArtifactAnnotation["kind"], string>
> = {
  pdf: "PDF",
  pptx: "PPTX",
  docx: "DOCX",
  xlsx: "XLSX",
  csv: "CSV",
  md: "MD",
  txt: "TXT",
  zip: "ZIP",
  json: "JSON",
  document: "Documento",
  image: "Imagem",
  diagram: "Diagrama",
  slides: "Slides",
  note: "Nota",
  video: "Vídeo",
};

const RELATED_CONTENT_HEADING_PATTERN = /^conte[uú]dos?\s+relacionados?\b/i;

function plainHeadingText(raw: string): string {
  return raw.replace(/[*_`~]/g, "").trim();
}

function isRelatedListOrLinkLine(line: string): boolean {
  return (
    !line.trim() ||
    /^\s*(?:[-*+]|\d+\.)\s+/.test(line) ||
    /^\s*\[[^\]]+\]\([^)]+\)\s*$/.test(line)
  );
}

function processRelatedSectionLine(
  line: string,
  state: { fence: boolean; headingLevel: number; boldList: boolean },
): boolean {
  if (/^\s*```/.test(line)) {
    state.fence = !state.fence;

    return !state.headingLevel;
  }

  if (state.fence) return !state.headingLevel;

  const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);

  if (headingMatch) {
    const level = headingMatch[1].length;

    state.boldList = false;

    if (state.headingLevel && level > state.headingLevel) return false;

    if (
      RELATED_CONTENT_HEADING_PATTERN.test(plainHeadingText(headingMatch[2]))
    ) {
      state.headingLevel = level;

      return false;
    }

    state.headingLevel = 0;

    return true;
  }

  if (state.headingLevel) return false;

  const boldMatch = /^\s*(?:\*\*|__)([^*_\n]+)(?:\*\*|__)\s*$/.exec(line);

  if (
    boldMatch &&
    RELATED_CONTENT_HEADING_PATTERN.test(plainHeadingText(boldMatch[1]))
  ) {
    state.boldList = true;

    return false;
  }

  if (state.boldList) {
    if (isRelatedListOrLinkLine(line)) return false;

    state.boldList = false;
  }

  return true;
}

/**
 * Removes related-content headings or standalone bold sections and their
 * nested lists/links outside fenced code blocks.
 */
export function stripRelatedContentSections(markdown: string): string {
  if (!markdown) return "";

  const state = { fence: false, headingLevel: 0, boldList: false };

  const kept = markdown
    .split("\n")
    .filter((line) => processRelatedSectionLine(line, state));

  const collapsed = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return collapsed ? `${collapsed}\n` : "";
}

const ARTIFACT_KINDS: readonly DownloadedArtifactAnnotation["kind"][] = [
  "pdf",
  "pptx",
  "docx",
  "xlsx",
  "csv",
  "md",
  "txt",
  "zip",
  "json",
  "document",
  "image",
  "diagram",
  "slides",
  "note",
  "video",
];

function artifactDisplayPath(artifact: DownloadedArtifactAnnotation): string {
  return artifact.folderLabel
    ? `${artifact.folderLabel} / ${artifact.filename}`
    : artifact.filename;
}

function artifactInlineSuffix(artifact: DownloadedArtifactAnnotation): string {
  const status = artifact.alreadyDownloaded
    ? "Já baixado como"
    : "Baixado como";

  return ` — ${status} \`${artifactDisplayPath(artifact)}\``;
}

function registerArtifactKey(
  lookup: Map<string, AnnotationEntry>,
  key: string,
  entry: AnnotationEntry,
): void {
  if (key && !lookup.has(key)) lookup.set(key, entry);
}

function buildArtifactLookup(
  artifacts: readonly DownloadedArtifactAnnotation[],
  normalizeUrl: (
    url: string,
    kind: DownloadedArtifactAnnotation["kind"],
  ) => string,
): {
  readonly entries: readonly AnnotationEntry[];
  readonly lookup: Map<string, AnnotationEntry>;
} {
  const entries: AnnotationEntry[] = [];
  const lookup = new Map<string, AnnotationEntry>();

  for (const artifact of artifacts) {
    const entry: AnnotationEntry = { artifact, matchedInline: false };

    entries.push(entry);
    registerArtifactKey(lookup, artifact.url, entry);

    registerArtifactKey(
      lookup,
      normalizeUrl(artifact.url, artifact.kind),
      entry,
    );

    if (artifact.fallbackUrl) {
      registerArtifactKey(lookup, artifact.fallbackUrl, entry);

      registerArtifactKey(
        lookup,
        normalizeUrl(artifact.fallbackUrl, artifact.kind),
        entry,
      );
    }
  }

  return { entries, lookup };
}

function findMatchingAnnotation(
  href: string,
  lookup: Map<string, AnnotationEntry>,
  normalizeUrl: (
    url: string,
    kind: DownloadedArtifactAnnotation["kind"],
  ) => string,
): AnnotationEntry | null {
  const direct = lookup.get(href);

  if (direct) return direct;

  for (const kind of ARTIFACT_KINDS) {
    const hit = lookup.get(normalizeUrl(href, kind));

    if (hit) return hit;
  }

  return null;
}

function annotateMarkdownLine(
  line: string,
  lookup: Map<string, AnnotationEntry>,
  normalizeUrl: (
    url: string,
    kind: DownloadedArtifactAnnotation["kind"],
  ) => string,
): string {
  return line.replace(
    /\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/g,
    (fullLink, href: string) => {
      const match = findMatchingAnnotation(href, lookup, normalizeUrl);

      if (!match) return fullLink;

      match.matchedInline = true;

      if (line.includes(match.artifact.filename)) return fullLink;

      return `${fullLink}${artifactInlineSuffix(match.artifact)}`;
    },
  );
}

function buildUnmatchedArtifactsSection(
  entries: readonly AnnotationEntry[],
): string {
  const seenFooter = new Set<string>();
  const footerLines: string[] = [];

  for (const entry of entries) {
    if (entry.matchedInline) continue;

    const displayPath = artifactDisplayPath(entry.artifact);
    const dedupKey = `${entry.artifact.kind}|${displayPath}`;

    if (seenFooter.has(dedupKey)) continue;
    seenFooter.add(dedupKey);

    const status = entry.artifact.alreadyDownloaded ? "já baixado" : "baixado";

    footerLines.push(
      `- ${ARTIFACT_KIND_LABELS[entry.artifact.kind]}: \`${displayPath}\` (${status})`,
    );
  }

  if (!footerLines.length) return "";

  return `## Arquivos baixados\n\n${footerLines.join("\n")}`;
}

/**
 * Annotates inline Markdown links with their saved local filename in Portuguese
 * (including cross-folder reuse notes) and lists any non-inline attachments
 * under a trailing `## Arquivos baixados` section.
 */
export function annotateMarkdownWithDownloadedArtifacts(
  markdown: string,
  artifacts: readonly DownloadedArtifactAnnotation[],
  normalizeUrl: (
    url: string,
    kind: DownloadedArtifactAnnotation["kind"],
  ) => string,
): string {
  if (!markdown.trim() || artifacts.length === 0) return markdown;

  const { entries, lookup } = buildArtifactLookup(artifacts, normalizeUrl);
  const lines = markdown.replace(/\r?\n$/, "").split("\n");
  const fence = { active: false };

  const annotatedLines = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      fence.active = !fence.active;

      return line;
    }

    if (fence.active) return line;

    return annotateMarkdownLine(line, lookup, normalizeUrl);
  });

  const footer = buildUnmatchedArtifactsSection(entries);
  const body = annotatedLines.join("\n").replace(/\n+$/, "");

  return footer ? `${body}\n\n${footer}\n` : `${body}\n`;
}
