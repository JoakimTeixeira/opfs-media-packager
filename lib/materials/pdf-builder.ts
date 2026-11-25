export interface PdfJpegPage {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

interface JpegDimensions {
  readonly width: number;
  readonly height: number;
}

const PDF_PAGE_WIDTH_PT = 960;

const ASCII_ENCODER = new TextEncoder();

const PDF_HEADER_BYTES = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf,
  0xd3, 0x0a,
]);

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function findMarkerByteOffset(bytes: Uint8Array, start: number): number {
  if (bytes[start] !== 0xff) return -1;
  const cursor = { index: start + 1 };

  while (cursor.index < bytes.length && bytes[cursor.index] === 0xff) {
    cursor.index += 1;
  }

  return cursor.index < bytes.length ? cursor.index : -1;
}

function isEndOfHeaderMarker(marker: number): boolean {
  return marker === 0xd9 || marker === 0xda;
}

function isSofFrameMarker(marker: number): boolean {
  return marker === 0xc0 || marker === 0xc2;
}

function parseSofDimensions(
  bytes: Uint8Array,
  markerOffset: number,
): JpegDimensions | null {
  if (markerOffset + 7 >= bytes.length) return null;
  const height = readUint16Be(bytes, markerOffset + 4);
  const width = readUint16Be(bytes, markerOffset + 6);

  return width > 0 && height > 0 ? Object.freeze({ width, height }) : null;
}

function nextSegmentOffset(bytes: Uint8Array, markerOffset: number): number {
  if (markerOffset + 2 >= bytes.length) return -1;
  const segmentLength = readUint16Be(bytes, markerOffset + 1);

  return segmentLength >= 2 ? markerOffset + 1 + segmentLength : -1;
}

/**
 * Extracts pixel width and height from a baseline (`SOF0`) or progressive
 * (`SOF2`) JPEG byte stream, returning `null` if invalid or truncated.
 */
export function jpegDimensions(bytes: Uint8Array): JpegDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const cursor = { offset: 2 };

  while (cursor.offset < bytes.length) {
    const markerOffset = findMarkerByteOffset(bytes, cursor.offset);

    if (markerOffset < 0) return null;
    const marker = bytes[markerOffset];

    if (isEndOfHeaderMarker(marker)) return null;

    if (isSofFrameMarker(marker)) {
      return parseSofDimensions(bytes, markerOffset);
    }

    const next = nextSegmentOffset(bytes, markerOffset);

    if (next < 0) return null;
    cursor.offset = next;
  }

  return null;
}

function validatePdfPages(pages: readonly PdfJpegPage[]): void {
  if (pages.length === 0) {
    throw new Error("Cannot build a PDF without any pages.");
  }

  for (const page of pages) {
    if (page.bytes.length === 0) {
      throw new Error("PDF page must include non-empty JPEG bytes.");
    }

    if (
      !Number.isFinite(page.width) ||
      !Number.isFinite(page.height) ||
      page.width <= 0 ||
      page.height <= 0
    ) {
      throw new Error("PDF page width and height must be positive.");
    }
  }
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalBytes);
  const cursor = { offset: 0 };

  for (const chunk of chunks) {
    output.set(chunk, cursor.offset);
    cursor.offset += chunk.length;
  }

  return output;
}

function pdfObjectBytes(
  id: number,
  ...parts: readonly (string | Uint8Array)[]
): Uint8Array {
  const encodedParts = parts.map((part) =>
    typeof part === "string" ? ASCII_ENCODER.encode(part) : part,
  );

  return concatUint8Arrays([
    ASCII_ENCODER.encode(`${id} 0 obj\n`),
    ...encodedParts,
    ASCII_ENCODER.encode("\nendobj\n"),
  ]);
}

function pageObjectGroup(
  page: PdfJpegPage,
  pageIndex: number,
): readonly Uint8Array[] {
  const pageId = 3 + pageIndex * 3;
  const contentId = pageId + 1;
  const imageId = pageId + 2;
  const ptWidth = PDF_PAGE_WIDTH_PT;

  const ptHeight = Math.max(
    1,
    Math.round((ptWidth * page.height) / page.width),
  );

  const pixelWidth = Math.max(1, Math.round(page.width));
  const pixelHeight = Math.max(1, Math.round(page.height));
  const streamText = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im0 Do Q`;
  const streamBytes = ASCII_ENCODER.encode(streamText);

  const pageObj = pdfObjectBytes(
    pageId,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
  );

  const contentObj = pdfObjectBytes(
    contentId,
    `<< /Length ${streamBytes.length} >>\nstream\n`,
    streamBytes,
    "\nendstream",
  );

  const imageObj = pdfObjectBytes(
    imageId,
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
    page.bytes,
    "\nendstream",
  );

  return [pageObj, contentObj, imageObj];
}

function buildXrefAndTrailer(
  offsets: readonly number[],
  xrefOffset: number,
): Uint8Array {
  const size = offsets.length + 1;

  const entries = offsets.map(
    (offset) => `${String(offset).padStart(10, "0")} 00000 n \n`,
  );

  const text = [
    `xref\n0 ${size}\n0000000000 65535 f \n`,
    ...entries,
    `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");

  return ASCII_ENCODER.encode(text);
}

/**
 * Builds a zero-dependency binary PDF-1.4 document embedding one JPEG XObject
 * per page at landscape width 960 pt.
 */
export function buildPdfFromJpegPages(
  pages: readonly PdfJpegPage[],
): Uint8Array {
  validatePdfPages(pages);

  const kidRefs = pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");

  const objects: Uint8Array[] = [
    pdfObjectBytes(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObjectBytes(
      2,
      `<< /Type /Pages /Count ${pages.length} /Kids [${kidRefs}] >>`,
    ),
    ...pages.flatMap(pageObjectGroup),
  ];

  const offsets: number[] = [];
  const cursor = { offset: PDF_HEADER_BYTES.length };

  for (const objectBytes of objects) {
    offsets.push(cursor.offset);
    cursor.offset += objectBytes.length;
  }

  const footer = buildXrefAndTrailer(offsets, cursor.offset);

  return concatUint8Arrays([PDF_HEADER_BYTES, ...objects, footer]);
}
