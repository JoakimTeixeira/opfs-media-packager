export const MIN_SEGMENT_CONCURRENCY = 1;
export const MAX_SEGMENT_CONCURRENCY = 10;
export const DEFAULT_SEGMENT_CONCURRENCY = 3;

export function clampConcurrency(value: number): number {
  return Math.max(
    MIN_SEGMENT_CONCURRENCY,
    Math.min(
      MAX_SEGMENT_CONCURRENCY,
      Number.isFinite(value) ? Math.trunc(value) : DEFAULT_SEGMENT_CONCURRENCY,
    ),
  );
}

/**
 * Groups consecutive video segments by the requested parallel download count.
 * Groups are written in source order so the final video keeps correct timing.
 */
export function orderedSegmentGroups<T>(
  values: readonly T[],
  concurrency: number,
): T[][] {
  const size = clampConcurrency(concurrency);
  const groupCount = Math.ceil(values.length / size);

  return Array.from({ length: groupCount }, (_slot, groupIndex) => [
    ...values.slice(groupIndex * size, (groupIndex + 1) * size),
  ]);
}
