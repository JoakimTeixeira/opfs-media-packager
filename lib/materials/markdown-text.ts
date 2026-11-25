const MARKDOWN_SPACE_CODES = new Set([
  0x000b, 0x000c, 0x00a0, 0x1680, 0x202f, 0x205f, 0x3000,
]);

const STRIP_CODE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xd800, 0xdfff],
  [0xe000, 0xf8ff],
  [0xfdd0, 0xfdef],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xfffc, 0xffff],
  [0xe0100, 0xe01ef],
  [0xf0000, 0x10ffff],
];

function mapMarkdownCodePoint(char: string, preserveTabs: boolean): string {
  const code = char.codePointAt(0) as number;

  if (code === 0x09) return preserveTabs ? "\t" : " ";
  if (code === 0x2028 || code === 0x2029) return "\n";

  if (MARKDOWN_SPACE_CODES.has(code) || (code >= 0x2000 && code <= 0x200a)) {
    return " ";
  }

  if (
    (code & 0xffff) >= 0xfffe ||
    STRIP_CODE_RANGES.some(([min, max]) => code >= min && code <= max)
  ) {
    return "";
  }

  return char;
}

/**
 * Removes unpaired surrogates, variation selectors, invisible format/control
 * characters, replacement glyphs, and Private-Use icons from Markdown text
 * while converting exotic whitespace to standard spaces and normalizing leading
 * Private-Use bullet glyphs.
 */
export function sanitizeMarkdownText(
  raw: string,
  options?: { readonly preserveTabs?: boolean },
): string {
  const preserveTabs = options?.preserveTabs === true;

  const normalizedBullets = raw.replace(
    /(^|\r?\n)[\uE000-\uF8FF](?=\s|$)/g,
    "$1•",
  );

  return Array.from(normalizedBullets, (char) =>
    mapMarkdownCodePoint(char, preserveTabs),
  ).join("");
}
