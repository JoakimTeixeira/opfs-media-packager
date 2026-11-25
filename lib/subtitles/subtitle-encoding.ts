const WINDOWS_1252_EXTRA = new Map<string, number>([
  ["\u20AC", 0x80],
  ["\u201A", 0x82],
  ["\u0192", 0x83],
  ["\u201E", 0x84],
  ["\u2026", 0x85],
  ["\u2020", 0x86],
  ["\u2021", 0x87],
  ["\u02C6", 0x88],
  ["\u2030", 0x89],
  ["\u0160", 0x8a],
  ["\u2039", 0x8b],
  ["\u0152", 0x8c],
  ["\u017D", 0x8e],
  ["\u2018", 0x91],
  ["\u2019", 0x92],
  ["\u201C", 0x93],
  ["\u201D", 0x94],
  ["\u2022", 0x95],
  ["\u2013", 0x96],
  ["\u2014", 0x97],
  ["\u02DC", 0x98],
  ["\u2122", 0x99],
  ["\u0161", 0x9a],
  ["\u203A", 0x9b],
  ["\u0153", 0x9c],
  ["\u017E", 0x9e],
  ["\u0178", 0x9f],
]);

const CONTINUATION_BYTE_CHARS =
  "\u0080-\u00BF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178";

const MOJIBAKE_MARKER_PATTERN = new RegExp(
  `(?:[ÃÂ][${CONTINUATION_BYTE_CHARS}]|â(?:€[${CONTINUATION_BYTE_CHARS}]|‚¬|[\u0080-\u00BF][${CONTINUATION_BYTE_CHARS}])|ï»¿)`,
  "g",
);

const LENIENT_UTF8_DECODER = new TextDecoder("utf-8");

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function windows1252Byte(char: string): number | null {
  const mapped = WINDOWS_1252_EXTRA.get(char);

  if (mapped !== undefined) return mapped;
  const code = char.charCodeAt(0);

  return code <= 0xff ? code : null;
}

function toWindows1252Bytes(text: string): Uint8Array | null {
  const bytes: number[] = [];

  for (const char of text) {
    const byte = windows1252Byte(char);

    if (byte === null) return null;
    bytes.push(byte);
  }

  return Uint8Array.from(bytes);
}

function decodeStrictUtf8(bytes: Uint8Array): string | null {
  try {
    return STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function countMojibakeMarkers(text: string): number {
  return text.match(MOJIBAKE_MARKER_PATTERN)?.length ?? 0;
}

function repairLine(line: string): string {
  const beforeMarkers = countMojibakeMarkers(line);

  if (beforeMarkers === 0) return line;
  const bytes = toWindows1252Bytes(line);

  if (!bytes) return line;
  const decoded = decodeStrictUtf8(bytes);

  if (
    decoded === null ||
    decoded.includes("\uFFFD") ||
    countMojibakeMarkers(decoded) >= beforeMarkers
  ) {
    return line;
  }

  return decoded;
}

/**
 * Repairs UTF-8 text that was decoded as Windows-1252/Latin-1 and re-encoded
 * as UTF-8, while leaving clean UTF-8 lines, CRLF separators, and lines with
 * non-Windows-1252 characters intact.
 */
export function repairDoubleEncodedUtf8(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map(repairLine)
    .join("");
}

/**
 * Decodes subtitle bytes as UTF-8, strips any leading BOM, and repairs
 * double-encoded Windows-1252 mojibake.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  const decoded = LENIENT_UTF8_DECODER.decode(bytes).replace(/^\uFEFF/, "");

  return repairDoubleEncodedUtf8(decoded).replace(/^\uFEFF/, "");
}
