import test from "node:test";
import assert from "node:assert/strict";
import { externalRecord, externalTabId } from "./external-values.ts";

test("should accept only plain object records and reject primitives, null, arrays, and functions", () => {
  assert.deepEqual(externalRecord({ ok: true }), { ok: true });
  assert.equal(externalRecord(null), null);
  assert.equal(externalRecord(undefined), null);
  assert.equal(externalRecord([]), null);
  assert.equal(externalRecord("text"), null);
  assert.equal(externalRecord(42), null);

  assert.equal(
    externalRecord(() => {}),
    null,
  );
});

test("should accept only non-negative safe integer tab identifiers", () => {
  assert.equal(externalTabId(0), 0);
  assert.equal(externalTabId(17), 17);
  assert.equal(externalTabId(-1), null);
  assert.equal(externalTabId(1.5), null);
  assert.equal(externalTabId("17"), null);
  assert.equal(externalTabId(Number.NaN), null);
});
