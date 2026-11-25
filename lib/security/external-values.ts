/**
 * Data received from browser messages, storage, and page scripts. Every
 * value is narrowed before it reaches a domain operation.
 */
export type ExternalValue = unknown;

export type ExternalRecord = Record<string, unknown>;

/** Narrows an external value to a property record. */
export function externalRecord(value: ExternalValue): ExternalRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ExternalRecord)
    : null;
}

/** Narrows a value to a whole non-negative browser tab identifier. */
export function externalTabId(value: ExternalValue): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
