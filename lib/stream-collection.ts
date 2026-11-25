import { qualityOptionKey } from "./hls-master.ts";
import { streamIdentity } from "./stream-identity.ts";

export interface StreamQualityLike {
  readonly url?: string;
  readonly label?: string;
}

export interface StreamSubtitleLike {
  readonly url?: string;
}

export interface MergeableStream {
  readonly url?: string;
  readonly key?: string;
  readonly kind?: string;
  readonly qualityOptions?: readonly StreamQualityLike[];
  readonly subtitles?: readonly StreamSubtitleLike[];
}

function uniqueQualityOptions<Q extends StreamQualityLike>(
  values: readonly Q[],
): Q[] {
  return values
    .filter(
      (value, index, all) =>
        typeof value?.url === "string" &&
        all.findIndex(
          (other) =>
            typeof other?.url === "string" &&
            qualityOptionKey(other) === qualityOptionKey(value),
        ) === index,
    )
    .sort(
      (left, right) =>
        Number.parseInt(right.label || "0", 10) -
        Number.parseInt(left.label || "0", 10),
    );
}

function uniqueSubtitleTracks<S extends StreamSubtitleLike>(
  values: readonly S[],
): S[] {
  return values.filter(
    (value, index, all) =>
      typeof value?.url === "string" &&
      all.findIndex((other) => other?.url === value.url) === index,
  );
}

function streamOptionList(
  stream: MergeableStream,
): readonly StreamQualityLike[] {
  return stream.qualityOptions || [];
}

function streamSubtitleList(
  stream: MergeableStream,
): readonly StreamSubtitleLike[] {
  return stream.subtitles || [];
}

function combineStreamPair<T extends MergeableStream>(
  current: T,
  incoming: T,
  key: string,
): T {
  const currentOptions = streamOptionList(current);
  const incomingOptions = streamOptionList(incoming);

  const preferred =
    incoming.kind === "master" || incomingOptions.length > currentOptions.length
      ? incoming
      : current;

  const isMaster = current.kind === "master" || incoming.kind === "master";

  return {
    ...preferred,
    key,
    kind: isMaster ? "master" : preferred.kind,
    qualityOptions: uniqueQualityOptions([
      ...currentOptions,
      ...incomingOptions,
    ]),
    subtitles: uniqueSubtitleTracks([
      ...streamSubtitleList(current),
      ...streamSubtitleList(incoming),
    ]),
  };
}

/**
 * Consolidates observations of the same video player. CDN access tokens and
 * individual quality playlist requests are transport details, not separate
 * videos.
 */
export function mergeDetectedStreams<T extends MergeableStream>(
  streams: readonly T[],
): T[] {
  const merged = new Map<string, T>();

  for (const stream of streams) {
    if (!stream || typeof stream !== "object") continue;
    const key = streamIdentity(stream.url || "") || stream.key || stream.url;

    if (!key) continue;
    const current = merged.get(key);

    merged.set(
      key,
      current ? combineStreamPair(current, stream, key) : { ...stream, key },
    );
  }

  return [...merged.values()];
}
