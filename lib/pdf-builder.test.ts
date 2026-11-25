import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfFromJpegPages,
  jpegDimensions,
  type PdfJpegPage,
} from "./pdf-builder.ts";

function fakeJpegSof(
  marker: 0xc0 | 0xc2,
  width: number,
  height: number,
  options: { readonly fillBytes?: boolean } = {},
): Uint8Array {
  const bytes: number[] = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff,
  ];

  if (options.fillBytes) bytes.push(0xff);

  bytes.push(
    marker,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  );

  return Uint8Array.from(bytes);
}

function asciiSlice(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder("latin1").decode(
    bytes.subarray(start, start + length),
  );
}

test("should build a valid PDF-1.4 document with exact xref byte offsets", () => {
  const jpegOne = fakeJpegSof(0xc0, 1920, 1080);
  const jpegTwo = fakeJpegSof(0xc2, 800, 600, { fillBytes: true });

  const pages: readonly PdfJpegPage[] = [
    { bytes: jpegOne, width: 1920, height: 1080 },
    { bytes: jpegTwo, width: 800, height: 600 },
  ];

  const pdfBytes = buildPdfFromJpegPages(pages);

  const pdfText = new TextDecoder("latin1").decode(pdfBytes);

  assert.equal(pdfText.startsWith("%PDF-1.4\n"), true);
  assert.equal(pdfText.endsWith("%%EOF\n"), true);

  assert.match(
    pdfText,
    /<< \/Type \/Pages \/Count 2 \/Kids \[3 0 R 6 0 R\] >>/,
  );

  assert.match(pdfText, /\/MediaBox \[0 0 960 540\]/);
  assert.match(pdfText, /\/MediaBox \[0 0 960 720\]/);
  assert.match(pdfText, /q 960 0 0 540 0 0 cm \/Im0 Do Q/);
  assert.match(pdfText, /q 960 0 0 720 0 0 cm \/Im0 Do Q/);

  assert.match(
    pdfText,
    new RegExp(
      `/Subtype /Image /Width 1920 /Height 1080 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegOne.length}`,
    ),
  );

  const startxrefMatch = /startxref\n(\d+)\n%%EOF\n$/.exec(pdfText);

  assert.ok(startxrefMatch);
  const xrefOffset = Number(startxrefMatch[1]);

  assert.equal(asciiSlice(pdfBytes, xrefOffset, 5), "xref\n");

  const xrefSection = pdfText.slice(xrefOffset);
  const xrefLines = xrefSection.split("\n");

  assert.equal(xrefLines[1], "0 9");
  assert.equal(xrefLines[2], "0000000000 65535 f ");

  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const entry = xrefLines[2 + id];
    const match = /^(\d{10}) 00000 n $/.exec(entry);

    assert.ok(match, `Invalid xref entry for object ${id}: ${entry}`);
    const objOffset = Number(match[1]);
    const expectedPrefix = `${id} 0 obj\n`;

    assert.equal(
      asciiSlice(pdfBytes, objOffset, expectedPrefix.length),
      expectedPrefix,
    );
  }

  assert.match(pdfText, /trailer\n<< \/Size 9 \/Root 1 0 R >>/);
});

test("should throw on empty page list, empty bytes, or non-positive page dimensions", () => {
  assert.throws(() => buildPdfFromJpegPages([]), {
    message: "Cannot build a PDF without any pages.",
  });

  assert.throws(
    () =>
      buildPdfFromJpegPages([
        { bytes: new Uint8Array(), width: 100, height: 100 },
      ]),
    /non-empty JPEG bytes/,
  );

  for (const invalidSize of [
    { width: 0, height: 100 },
    { width: 100, height: 0 },
    { width: -10, height: 100 },
    { width: Number.NaN, height: 100 },
    { width: 100, height: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () =>
        buildPdfFromJpegPages([
          { bytes: Uint8Array.from([0xff, 0xd8]), ...invalidSize },
        ]),
      /positive/,
    );
  }
});

test("should extract dimensions from SOF0 and SOF2 JPEGs and return null for invalid streams", () => {
  assert.deepEqual(jpegDimensions(fakeJpegSof(0xc0, 1920, 1080)), {
    width: 1920,
    height: 1080,
  });

  assert.deepEqual(
    jpegDimensions(fakeJpegSof(0xc2, 1280, 720, { fillBytes: true })),
    {
      width: 1280,
      height: 720,
    },
  );

  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0x00, 0xd8, 0xff, 0xc0])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0x00, 0xff, 0xc0])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0x00, 0xc0])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xff])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xda])), null);

  assert.equal(
    jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11])),
    null,
  );

  assert.equal(
    jpegDimensions(
      Uint8Array.from([
        0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x00, 0x01, 0x00,
      ]),
    ),
    null,
  );

  assert.equal(
    jpegDimensions(
      Uint8Array.from([
        0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x00, 0x00, 0x00,
      ]),
    ),
    null,
  );

  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), null);

  assert.equal(
    jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])),
    null,
  );

  assert.equal(
    jpegDimensions(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    ),
    null,
  );
});
