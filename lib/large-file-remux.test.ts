import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINT_PART_SEGMENTS,
  OPFS_JOB_PREFIX,
  OPFS_RESUME_PREFIX,
  buildConcatManifest,
  canonicalResumeStreamKey,
  checkpointPartSize,
  classifyRemuxErrorKind,
  expiredResumeJobNames,
  nextAdaptiveConcurrency,
  parseFfmpegProgressLine,
  parseRetryAfterMs,
  segmentRetryDelayMs,
  shouldSplitDiscontinuityPart,
  staleOpfsJobNames,
  validateResumeCheckpoint,
} from "./large-file-remux.ts";

test("should build an FFmpeg concat manifest from ordered part paths", () => {
  assert.equal(
    buildConcatManifest(["/opfs/part-000001.ts", "/opfs/part-000002.ts"]),
    "file '/opfs/part-000001.ts'\nfile '/opfs/part-000002.ts'",
  );

  assert.equal(buildConcatManifest([]), "");
});

test("should split OPFS part files only on discontinuities after the first segment", () => {
  assert.equal(shouldSplitDiscontinuityPart(false, 0), false);
  assert.equal(shouldSplitDiscontinuityPart(false, 5), false);
  assert.equal(shouldSplitDiscontinuityPart(true, 0), false);
  assert.equal(shouldSplitDiscontinuityPart(true, 1), true);
});

test("should select only stale OPFS job directories while preserving active and unrelated entries", () => {
  const entries = [
    `${OPFS_JOB_PREFIX}stale-1`,
    `${OPFS_JOB_PREFIX}active-job`,
    `${OPFS_JOB_PREFIX}stale-2`,
    "other-extension-dir",
  ];

  assert.deepEqual(staleOpfsJobNames(entries, `${OPFS_JOB_PREFIX}active-job`), [
    `${OPFS_JOB_PREFIX}stale-1`,
    `${OPFS_JOB_PREFIX}stale-2`,
  ]);

  assert.deepEqual(staleOpfsJobNames(entries, null), [
    `${OPFS_JOB_PREFIX}stale-1`,
    `${OPFS_JOB_PREFIX}active-job`,
    `${OPFS_JOB_PREFIX}stale-2`,
  ]);
});

test("should parse FFmpeg stderr progress timestamps and faststart pass transitions", () => {
  assert.deepEqual(
    parseFfmpegProgressLine(
      "frame= 12000 fps=4000 q=-1.0 size= 200000kB time=00:53:20.00 bitrate= 512.0kbits/s",
      6400,
    ),
    { phase: "remux", percent: 50 },
  );

  assert.deepEqual(
    parseFfmpegProgressLine(
      "frame=230400 fps=6700 q=-1.0 Lsize= 543617kB time=02:08:00.00 bitrate= 579.9kbits/s",
      6400,
    ),
    { phase: "remux", percent: 99 },
  );

  assert.deepEqual(
    parseFfmpegProgressLine(
      "frame=120 fps=300 time=00:00:04.00 bitrate=200kbits/s",
      0,
    ),
    { phase: "remux", percent: null },
  );

  assert.deepEqual(
    parseFfmpegProgressLine(
      "[mp4 @ 0x1631940] Starting second pass: moving the moov atom to the beginning of the file",
      6400,
    ),
    { phase: "faststart", percent: null },
  );

  assert.equal(parseFfmpegProgressLine("Input #0, mpegts", 6400), null);
});

test("should classify engine, memory, storage, auth, rate-limit, and item failures", () => {
  assert.equal(
    classifyRemuxErrorKind("Segment 4 failed: HTTP 429"),
    "rate-limited",
  );

  assert.equal(
    classifyRemuxErrorKind("HTTP 503 Service Unavailable"),
    "rate-limited",
  );

  assert.equal(
    classifyRemuxErrorKind("Playlist request failed: HTTP 401."),
    "unauthorized",
  );

  assert.equal(
    classifyRemuxErrorKind("Playlist request failed: HTTP 403."),
    "unauthorized",
  );

  assert.equal(
    classifyRemuxErrorKind("The MP4 engine stopped unexpectedly."),
    "engine",
  );

  assert.equal(
    classifyRemuxErrorKind(
      "FFmpeg could not create this MP4 file (exit code 1).",
    ),
    "engine",
  );

  assert.equal(
    classifyRemuxErrorKind("RangeError: Array buffer allocation failed"),
    "engine",
  );

  assert.equal(
    classifyRemuxErrorKind("QuotaExceededError: storage quota exceeded"),
    "engine",
  );

  assert.equal(
    classifyRemuxErrorKind(
      "WebAssembly.RuntimeError: memory access out of bounds",
    ),
    "engine",
  );

  assert.equal(
    classifyRemuxErrorKind(
      "Chrome could not prepare the requested download name.",
    ),
    "engine",
  );

  assert.equal(classifyRemuxErrorKind("Segment 12 failed: HTTP 404"), "item");
});

test("should derive deterministic OPFS resume keys and checkpoint sizes across token rotations", () => {
  assert.equal(checkpointPartSize(50), CHECKPOINT_PART_SEGMENTS);
  assert.equal(checkpointPartSize(2195), 100);
  assert.equal(checkpointPartSize(10000), 250);

  const keyA = canonicalResumeStreamKey(
    "https://cdn.example.net/token=abc123&expires=999/asset-1/hls/playlist_1.m3u8?v=1",
    2195,
  );

  const keyB = canonicalResumeStreamKey(
    "https://cdn.example.net/token=xyz789&expires=1234/asset-1/hls/playlist_1.m3u8?v=2",
    2195,
  );

  const key720p = canonicalResumeStreamKey(
    "https://cdn.example.net/token=xyz789&expires=1234/asset-1/hls/playlist_2.m3u8",
    2195,
  );

  const fallbackKey = canonicalResumeStreamKey("not a valid url", 42);

  assert.ok(keyA.startsWith(OPFS_RESUME_PREFIX));
  assert.equal(keyA, keyB);
  assert.notEqual(keyA, key720p);
  assert.ok(fallbackKey.startsWith(OPFS_RESUME_PREFIX));
});

test("should parse Retry-After delays, backoff durations, and adaptive concurrency", () => {
  assert.equal(parseRetryAfterMs(null, 1500), 1500);
  assert.equal(parseRetryAfterMs("0", 1500), 250);
  assert.equal(parseRetryAfterMs("2", 1500), 2000);
  assert.equal(parseRetryAfterMs("30", 1500, 6000), 6000);
  assert.equal(parseRetryAfterMs("invalid-date", 1800), 1800);

  const now = Date.UTC(2026, 10, 24, 12, 0, 0);

  assert.equal(
    parseRetryAfterMs("Tue, 24 Nov 2026 12:00:04 GMT", 1500, 6000, now),
    4000,
  );

  assert.equal(
    parseRetryAfterMs("Tue, 24 Nov 2026 12:01:00 GMT", 1500, 6000, now),
    6000,
  );

  assert.equal(
    parseRetryAfterMs("Tue, 24 Nov 2026 11:59:50 GMT", 1500, 6000, now),
    250,
  );

  assert.equal(segmentRetryDelayMs(1), 750);
  assert.equal(segmentRetryDelayMs(4), 5000);
  assert.equal(segmentRetryDelayMs(99), 8000);
  assert.equal(segmentRetryDelayMs(1, 429), 1500);
  assert.equal(segmentRetryDelayMs(2, 503), 3500);
  assert.equal(segmentRetryDelayMs(1, 429, "3"), 3000);

  assert.equal(nextAdaptiveConcurrency(10, true), 5);
  assert.equal(nextAdaptiveConcurrency(1, true), 1);
  assert.equal(nextAdaptiveConcurrency(6, false), 6);
});

test("should validate OPFS resume checkpoints against verified sealed part sizes", () => {
  const sizes = new Map<string, number>([
    ["part-000001.ts", 4096],
    ["part-000002.ts", 2048],
  ]);

  const valid = validateResumeCheckpoint(
    {
      totalSegments: 150,
      completedSegments: 150,
      updatedAt: 123456,
      parts: [
        { name: "part-000001.ts", segments: 100, bytes: 4096 },
        { name: "part-000002.ts", segments: 50, bytes: 2048 },
      ],
    },
    150,
    sizes,
  );

  assert.deepEqual(valid, {
    totalSegments: 150,
    completedSegments: 150,
    updatedAt: 123456,
    parts: [
      { name: "part-000001.ts", segments: 100, bytes: 4096 },
      { name: "part-000002.ts", segments: 50, bytes: 2048 },
    ],
  });

  const withoutTimestamp = validateResumeCheckpoint(
    {
      totalSegments: 100,
      completedSegments: 100,
      parts: [{ name: "part-000001.ts", segments: 100, bytes: 4096 }],
    },
    100,
    sizes,
  );

  assert.equal(withoutTimestamp?.updatedAt, 0);
  assert.equal(validateResumeCheckpoint(null, 100, sizes), null);

  assert.equal(
    validateResumeCheckpoint(
      {
        totalSegments: 99,
        completedSegments: 99,
        parts: [{ name: "part-000001.ts", segments: 99, bytes: 4096 }],
      },
      100,
      sizes,
    ),
    null,
  );

  assert.equal(
    validateResumeCheckpoint(
      {
        totalSegments: 100,
        completedSegments: 100,
        parts: [null],
      },
      100,
      sizes,
    ),
    null,
  );

  assert.equal(
    validateResumeCheckpoint(
      {
        totalSegments: 100,
        completedSegments: 100,
        parts: [{ name: "bad.ts", segments: 100, bytes: 4096 }],
      },
      100,
      sizes,
    ),
    null,
  );

  assert.equal(
    validateResumeCheckpoint(
      {
        totalSegments: 100,
        completedSegments: 100,
        parts: [{ name: "part-000001.ts", segments: 0, bytes: 4096 }],
      },
      100,
      sizes,
    ),
    null,
  );

  assert.equal(
    validateResumeCheckpoint(
      {
        totalSegments: 100,
        completedSegments: 100,
        parts: [{ name: "part-000001.ts", segments: 100, bytes: 9999 }],
      },
      100,
      sizes,
    ),
    null,
  );

  assert.equal(
    validateResumeCheckpoint(
      {
        totalSegments: 100,
        completedSegments: 80,
        parts: [{ name: "part-000001.ts", segments: 100, bytes: 4096 }],
      },
      100,
      sizes,
    ),
    null,
  );
});

test("should prune expired and excess OPFS resume directories while keeping newest ones", () => {
  const now = 10_000_000;

  const entries = [
    { name: `${OPFS_RESUME_PREFIX}newest`, updatedAt: now - 1000 },
    { name: `${OPFS_RESUME_PREFIX}second`, updatedAt: now - 2000 },
    { name: `${OPFS_RESUME_PREFIX}third-excess`, updatedAt: now - 3000 },
    { name: `${OPFS_RESUME_PREFIX}active`, updatedAt: now - 9_999_999 },
    { name: `${OPFS_RESUME_PREFIX}too-old`, updatedAt: now - 90_000_000 },
    { name: "unrelated-dir", updatedAt: 0 },
  ];

  assert.deepEqual(
    expiredResumeJobNames(
      entries,
      `${OPFS_RESUME_PREFIX}active`,
      now,
      86_400_000,
      2,
    ),
    [`${OPFS_RESUME_PREFIX}third-excess`, `${OPFS_RESUME_PREFIX}too-old`],
  );
});
