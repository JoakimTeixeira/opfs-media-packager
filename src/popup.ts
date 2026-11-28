import type { TrackOutline } from "../lib/track/track-plan.ts";
import {
  DEFAULT_OUTPUT_FORMAT,
  OUTPUT_FORMAT_OPTIONS,
  outputFormatOrDefault,
  renderPreferenceOptions,
} from "../lib/downloads/download-preferences.ts";
import type { VideoQualityOption } from "../lib/media/hls-master.ts";
import { icon } from "../lib/shared/icons.ts";
import { mergeDetectedStreams } from "../lib/media/stream-collection.ts";
import {
  uniqueKnownSubtitleTracks,
  type KnownSubtitleTrack,
  type SubtitleTrackCandidate,
} from "../lib/subtitles/subtitle-tracks.ts";

interface DetectedStream {
  readonly key: string;
  readonly url: string;
  readonly title: string;
  readonly kind?: string;
  readonly sourceUrl?: string;
  readonly subtitles?: readonly SubtitleTrackCandidate[];
  readonly qualityOptions?: readonly VideoQualityOption[];
}

interface PopupState {
  readonly streams?: readonly DetectedStream[];
  readonly subtitles?: readonly SubtitleTrackCandidate[];
  readonly trackOutline?: TrackOutline | null;
  readonly preferredOutput?: string;
  readonly preferredQualityLabel: string;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) throw new Error(`Missing required element: ${selector}`);

  return element;
}

const list = requireElement<HTMLElement>("#list");
const site = requireElement<HTMLElement>("#site");
const clear = requireElement<HTMLButtonElement>("#clear");
const popupStatus = requireElement<HTMLElement>("#popup-status");

const [tab] = await chrome.tabs.query({
  active: true,
  lastFocusedWindow: true,
});

const tabId = tab?.id ?? null;
const activePageUrl = tab?.url || "";

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  content: string,
  className = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  element.textContent = content;
  element.className = className;

  return element;
}

function subtitleChoices(
  stream: DetectedStream,
  pageSubtitles: readonly SubtitleTrackCandidate[] | undefined,
): KnownSubtitleTrack[] {
  return uniqueKnownSubtitleTracks(stream.subtitles || [], pageSubtitles || []);
}

function announce(value: string): void {
  popupStatus.textContent = value;
}

function uniqueStreams(streams: readonly DetectedStream[]): DetectedStream[] {
  return mergeDetectedStreams(streams);
}

function preferredQualityIndex(
  qualityOptions: readonly VideoQualityOption[],
  preference: string,
): number {
  const index = qualityOptions.findIndex(
    (qualityOption) => qualityOption.label === preference,
  );

  return index < 0 ? 0 : index;
}

function render(state: PopupState): void {
  list.replaceChildren();
  const streams = uniqueStreams(state.streams || []);
  const trackDetected = Boolean(state.trackOutline?.items?.length);

  if (trackDetected && state.trackOutline) {
    const trackOutline = state.trackOutline;
    const trackCard = document.createElement("article");

    trackCard.className = "track-card";
    const copy = document.createElement("div");

    copy.append(
      node("div", trackOutline.title, "track-title"),
      node(
        "div",
        `${trackOutline.items.length} topics ready to scan`,
        "track-copy",
      ),
    );

    const scan = node("button", "Scan", "scan");

    scan.prepend(icon("scan", ["icon"]));

    scan.addEventListener("click", async () => {
      scan.disabled = true;

      const result = (await chrome.runtime
        .sendMessage({
          type: "start-track-scan",
          outline: trackOutline,
          sourceTabId: tabId,
        })
        .catch(() => ({ ok: false }))) as
        { ok?: boolean; error?: string } | undefined;

      if (!result?.ok) {
        scan.disabled = false;

        scan.replaceChildren(
          icon("scan", ["icon"]),
          document.createTextNode("Try again"),
        );

        announce(
          "The track scan could not start. Refresh the source page and try again.",
        );

        return;
      }

      window.close();
    });

    trackCard.append(copy, scan);
    list.append(trackCard);
  }

  if (!streams.length) {
    if (!trackDetected) {
      list.append(
        node("p", "No HLS manifest detected in this tab yet.", "empty"),
      );
    }

    return;
  }

  const streamList = trackDetected ? document.createElement("div") : list;

  streams.forEach((stream) => {
    const row = document.createElement("article");

    row.className = "item";
    const header = document.createElement("div");

    header.className = "stream-header";
    header.append(node("span", "HLS", "badge"));
    const copy = document.createElement("div");

    copy.className = "copy";

    copy.append(
      node("div", stream.title, "title"),
      node("div", "Detected stream", "host"),
    );

    header.append(copy);
    const copyUrl = node("button", "", "icon-button");

    copyUrl.type = "button";
    copyUrl.title = "Copy M3U8 URL";
    copyUrl.setAttribute("aria-label", "Copy M3U8 URL");
    copyUrl.append(icon("copy", ["icon"]));

    copyUrl.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(stream.url);
        copyUrl.classList.add("copied");
        copyUrl.title = "Copied";
        copyUrl.setAttribute("aria-label", "M3U8 URL copied");
        copyUrl.replaceChildren(icon("check", ["icon"]));
        announce("M3U8 URL copied.");

        setTimeout(() => {
          copyUrl.classList.remove("copied");
          copyUrl.title = "Copy M3U8 URL";
          copyUrl.setAttribute("aria-label", "Copy M3U8 URL");
          copyUrl.replaceChildren(icon("copy", ["icon"]));
        }, 1600);
      } catch {
        announce("Could not copy the M3U8 URL. Try again.");
      }
    });

    header.append(copyUrl);
    row.append(header);

    const qualityOptions = (stream.qualityOptions || []).filter(
      (qualityOption) => /^\d{3,4}p(?:\s|\(|$)/i.test(qualityOption.label),
    );

    const quality = document.createElement("select");

    quality.className = "quality";
    quality.setAttribute("aria-label", "Video quality");

    qualityOptions.forEach((qualityOption, index) => {
      quality.append(new Option(qualityOption.label, String(index)));
    });

    quality.disabled = !qualityOptions.length;

    quality.value = String(
      preferredQualityIndex(qualityOptions, state.preferredQualityLabel),
    );

    if (!qualityOptions.length) {
      quality.append(new Option("Quality options still loading…", ""));
    }

    const subtitles = subtitleChoices(stream, state.subtitles);
    const subtitle = document.createElement("select");

    subtitle.className = "subtitle";
    subtitle.setAttribute("aria-label", "Subtitle language");

    subtitles.forEach((track) => {
      subtitle.append(new Option(track.language, track.url));
    });

    subtitle.append(new Option("No subtitle", ""));
    subtitle.value = subtitles[0]?.url || "";
    const output = document.createElement("select");

    output.className = "output";
    output.setAttribute("aria-label", "Output format");
    renderPreferenceOptions(output, OUTPUT_FORMAT_OPTIONS);
    output.value = outputFormatOrDefault(state.preferredOutput);
    const button = node("button", "Download", "download");

    button.disabled = !qualityOptions.length;
    button.prepend(icon("download", ["icon"]));

    button.addEventListener("click", async () => {
      if (!qualityOptions.length) return;
      button.disabled = true;
      const qualityOption = qualityOptions[Number(quality.value)];

      const track =
        subtitles.find((item) => item.url === subtitle.value) || null;

      await chrome.storage.local.set({
        preferredOutput: output.value,
        preferredQualityLabel: qualityOption.label,
      });

      const result = (await chrome.runtime
        .sendMessage({
          type: "open-download",
          download: {
            url: qualityOption.url,
            title: stream.title,
            // Detection state can outlive a player navigation. The current tab
            // is the signed-in page that the user explicitly opened this popup
            // from, so it is the authoritative authorization context.
            sourceUrl: activePageUrl || stream.sourceUrl,
            sourceTabId: tabId,
            selectedQualityUrl: qualityOption.url,
            selectedLabel: qualityOption.label,
            qualityOptions,
            subtitle: track,
            outputFormat: output.value,
            autoStart: true,
          },
        })
        .catch(() => ({ ok: false }))) as
        { ok?: boolean; error?: string } | undefined;

      if (!result?.ok) {
        button.disabled = false;

        announce(
          "Could not open the download. Refresh the video page and try again.",
        );

        return;
      }

      window.close();
    });

    const controls = document.createElement("div");

    controls.className = "controls";
    controls.append(quality, subtitle, output, button);
    row.append(controls);
    streamList.append(row);
  });

  if (trackDetected) {
    const currentStreams = document.createElement("details");

    currentStreams.className = "current-streams";
    const summary = document.createElement("summary");

    summary.textContent = `Streams on this page (${streams.length})`;
    currentStreams.append(summary, streamList);
    currentStreams.open = true;
    list.append(currentStreams);
  }
}

site.textContent = tab?.url ? new URL(tab.url).host : "Current tab";

async function refreshPopup(): Promise<void> {
  if (!tabId) return;

  const [state, settings] = await Promise.all([
    chrome.runtime.sendMessage({ type: "list-detections", tabId }) as Promise<
      Partial<PopupState>
    >,
    chrome.storage.local.get({
      preferredOutput: DEFAULT_OUTPUT_FORMAT,
      preferredQualityLabel: "",
      renditionPreference: "",
      qualityPreference: "",
    }),
  ]);

  const legacyQualityPreference = String(settings.qualityPreference || "");

  // Earlier releases used the two names below. Save their value under the
  // current key after the popup reads it.
  const preferredQualityLabel =
    String(settings.preferredQualityLabel || "") ||
    String(settings.renditionPreference || "") ||
    legacyQualityPreference;

  if (!settings.preferredQualityLabel && preferredQualityLabel) {
    chrome.storage.local.set({ preferredQualityLabel });
  }

  render({
    ...state,
    preferredOutput: String(settings.preferredOutput || DEFAULT_OUTPUT_FORMAT),
    preferredQualityLabel,
  });
}

window.addEventListener("error", () =>
  announce("Something interrupted the popup. Reopen it and try again."),
);

window.addEventListener("unhandledrejection", () =>
  announce("Something interrupted the popup. Reopen it and try again."),
);

if (tabId) {
  await chrome.tabs
    .sendMessage(tabId, { type: "collect-track-outline" })
    .catch(() => {});

  await refreshPopup().catch(() =>
    announce("Could not load detected streams. Reopen the popup to retry."),
  );

  setTimeout(() => {
    refreshPopup().catch(() => {});
  }, 400);

  setTimeout(() => {
    refreshPopup().catch(() => {});
  }, 1500);
}

clear.addEventListener("click", async () => {
  if (!tabId) return;
  await chrome.runtime.sendMessage({ type: "clear-detections", tabId });
  render({ streams: [], subtitles: [], preferredQualityLabel: "" });
});
