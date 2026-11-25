import type { RemuxErrorKind } from "./large-file-remux.ts";

/** Mutable state owned by a single playlist download queue. */
export interface PlaylistQueueState {
  consecutiveAuthFailures: number;
  haltedKind: RemuxErrorKind | null;
}

/** Records a failed item and returns whether the playlist queue must pause. */
export function shouldHaltPlaylistQueue(
  kind: RemuxErrorKind,
  queueState: PlaylistQueueState,
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
