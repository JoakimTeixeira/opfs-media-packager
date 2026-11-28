import { test } from "vitest";
import assert from "node:assert/strict";
import { downloadControlState } from "./download-control-state.ts";

test("should enable choices while a known playlist is merely refreshing", () => {
  assert.deepEqual(
    downloadControlState({
      busy: true,
      hasPlaylist: true,
      downloadActive: false,
    }),
    {
      analyzeDisabled: true,
      cancelHidden: true,
      concurrencyDisabled: false,
      downloadDisabled: true,
      filenameDisabled: false,
      outputDisabled: false,
      qualityDisabled: false,
      saveSubfolderDisabled: false,
      subfolderDisabled: false,
    },
  );
});

test("should lock every output choice and reveal cancel only for a running download", () => {
  assert.deepEqual(
    downloadControlState({
      busy: true,
      hasPlaylist: true,
      downloadActive: true,
    }),
    {
      analyzeDisabled: true,
      cancelHidden: false,
      concurrencyDisabled: true,
      downloadDisabled: true,
      filenameDisabled: true,
      outputDisabled: true,
      qualityDisabled: true,
      saveSubfolderDisabled: true,
      subfolderDisabled: true,
    },
  );
});

test("should prevent download and quality selection before a playlist exists", () => {
  assert.deepEqual(
    downloadControlState({
      busy: false,
      hasPlaylist: false,
      downloadActive: false,
    }),
    {
      analyzeDisabled: false,
      cancelHidden: true,
      concurrencyDisabled: false,
      downloadDisabled: true,
      filenameDisabled: false,
      outputDisabled: false,
      qualityDisabled: true,
      saveSubfolderDisabled: false,
      subfolderDisabled: false,
    },
  );
});

test("should enable download when an idle playlist is ready", () => {
  assert.equal(
    downloadControlState({
      busy: false,
      hasPlaylist: true,
      downloadActive: false,
    }).downloadDisabled,
    false,
  );

  assert.equal(
    downloadControlState({
      busy: false,
      hasPlaylist: false,
      downloadActive: false,
      canResumeTrack: true,
    }).downloadDisabled,
    false,
  );
});
