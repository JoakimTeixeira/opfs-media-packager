import type { RemuxErrorKind } from "../downloads/large-file-remux.ts";

/** Mutable state owned by a single playlist download queue. */
export interface TrackQueueState {
  consecutiveAuthFailures: number;
  haltedKind: RemuxErrorKind | null;
}

/** Records a failed item and returns whether the playlist queue must pause. */
export function shouldHaltTrackQueue(
  kind: RemuxErrorKind,
  queueState: TrackQueueState,
): boolean {
  queueState.consecutiveAuthFailures =
    kind === "unauthorized" ? queueState.consecutiveAuthFailures + 1 : 0;

  if (
    kind === "rate-limited" ||
    kind === "engine" ||
    queueState.consecutiveAuthFailures >= 2
  ) {
    queueState.haltedKind = kind;

    return true;
  }

  return false;
}
