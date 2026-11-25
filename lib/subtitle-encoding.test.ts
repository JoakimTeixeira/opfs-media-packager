import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSubtitleBytes,
  repairDoubleEncodedUtf8,
} from "./subtitle-encoding.ts";

const UTF8_ENCODER = new TextEncoder();

const WINDOWS_1252_DECODER = new TextDecoder("windows-1252");

function doubleEncodeViaWindows1252(clean: string): string {
  return WINDOWS_1252_DECODER.decode(UTF8_ENCODER.encode(clean));
}

test("should repair double-encoded Portuguese phrases and punctuation", () => {
  const clean = [
    "vamos começar",
    "então",
    "1º",
    "É",
    "até",
    "inúmeras",
    "Em dash — teste",
    "Aspas ‘simples’ e “duplas” – €10 • fim…",
  ].join("\n");

  const mojibake = doubleEncodeViaWindows1252(clean);

  assert.notEqual(mojibake, clean);
  assert.match(mojibake, /comeÃ§ar/);
  assert.match(mojibake, /entÃ£o/);
  assert.match(mojibake, /1Âº/);
  assert.match(mojibake, /Ã‰/);
  assert.match(mojibake, /atÃ©/);
  assert.match(mojibake, /inÃºmeras/);
  assert.match(mojibake, /â€/);

  assert.equal(repairDoubleEncodedUtf8(mojibake), clean);
  assert.equal(repairDoubleEncodedUtf8(clean), clean);
});

test("should invert all 27 special Windows-1252 code points in 0x80-0x9F", () => {
  const cleanSpecials =
    "\u00C0\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CE\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D7\u00D8\u00D9\u00DA\u00DB\u00DC\u00DE\u00DF";

  const mojibake = doubleEncodeViaWindows1252(cleanSpecials);

  assert.equal(repairDoubleEncodedUtf8(mojibake), cleanSpecials);
});

test("should preserve CRLF vs LF line endings and VTT cue timestamps", () => {
  const cleanVtt = [
    "WEBVTT",
    "",
    "00:00:01.679 --> 00:00:05.919",
    "Olá! Vamos começar então — 1º módulo.",
    "",
    "00:00:06.000 --> 00:00:09.500",
    "É até possível ter inúmeras ideias.",
  ].join("\r\n");

  const mojibakeVtt = doubleEncodeViaWindows1252(cleanVtt);
  const repaired = repairDoubleEncodedUtf8(mojibakeVtt);

  assert.equal(repaired, cleanVtt);
  assert.equal(repaired.includes("\r\n"), true);
  assert.equal(repairDoubleEncodedUtf8(repaired), cleanVtt);
});

test("should decode subtitle bytes, strip UTF-8 BOM, and repair mojibake", () => {
  const cleanVtt =
    "WEBVTT\n\n00:00:01.679 --> 00:00:05.919\nVamos começar até amanhã.\n";

  const mojibakeBytes = UTF8_ENCODER.encode(
    `\uFEFF${doubleEncodeViaWindows1252(cleanVtt)}`,
  );

  assert.equal(decodeSubtitleBytes(mojibakeBytes), cleanVtt);

  const doubleEncodedBomBytes = UTF8_ENCODER.encode(
    doubleEncodeViaWindows1252(`\uFEFF${cleanVtt}`),
  );

  assert.equal(decodeSubtitleBytes(doubleEncodedBomBytes), cleanVtt);
  assert.equal(decodeSubtitleBytes(UTF8_ENCODER.encode(cleanVtt)), cleanVtt);
});

test("should fall back cleanly per line when lines have non-cp1252 chars, invalid UTF-8, U+FFFD, or non-reduced markers", () => {
  const input = [
    "entÃ£o",
    "Ã© 🎉",
    "Ã© é",
    "Ã© \u00EF\u00BF\u00BD",
    "Ã\u0083Æ\u0092",
    "comeÃ§ar",
  ].join("\r\n");

  const expected = [
    "então",
    "Ã© 🎉",
    "Ã© é",
    "Ã© \u00EF\u00BF\u00BD",
    "Ã\u0083Æ\u0092",
    "começar",
  ].join("\r\n");

  assert.equal(repairDoubleEncodedUtf8(input), expected);
});
