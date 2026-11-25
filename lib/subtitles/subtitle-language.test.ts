import { test } from "vitest";
import assert from "node:assert/strict";
import { languageInText } from "./subtitle-language.ts";

test("should use an explicit VTT language declaration", () => {
  assert.equal(languageInText("WEBVTT\nlanguage: en-US\n"), "English (US)");
  assert.equal(languageInText("lang: eo\n"), "eo");
});

test("should infer Portuguese from UUID VTT cue text", () => {
  const vtt =
    "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVocê não precisa fazer uma escolha agora.\n";

  assert.equal(languageInText(vtt), "Portuguese");
});

test("should infer Portuguese from short technical lesson titles and cues", () => {
  assert.equal(
    languageInText("[Aula] Como Adotar IA - Do Individual à Empresa"),
    "Portuguese",
  );

  assert.equal(
    languageInText("Introdução aos conceitos da arquitetura de sistemas"),
    "Portuguese",
  );
});

test("should infer English from short technical titles and cues", () => {
  assert.equal(
    languageInText(
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nWelcome to this lesson about distributed systems.\n",
    ),
    "English",
  );
});

test("should not invent a language for uninformative text", () => {
  assert.equal(
    languageInText("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n12345\n"),
    "",
  );
});

test("should recognize language aliases and avoid malformed declarations", () => {
  assert.equal(languageInText("LANG=pt_BR\n"), "Portuguese (Brazil)");
  assert.equal(languageInText("language = fr\n"), "French");
  assert.equal(languageInText("language: e\n"), "");
});

test("should remove VTT metadata, markup, and complete timing cues before inference", () => {
  const vtt =
    "WEBVTT - generated\n\n00:01:02.000 --> 00:01:04.000 align:start\n<c.green>The quick brown fox and you</c>\n\n01:02 --> 01:03\nThis is what you need";

  assert.equal(languageInText(vtt), "English");
});

test("should select a language only after at least two signals and resolve ties consistently", () => {
  assert.equal(languageInText("the single"), "");
  assert.equal(languageInText("the and uma você"), "Portuguese");
  assert.equal(languageInText("una está gracias nosotros"), "Spanish");
  assert.equal(languageInText("vous avec merci nous"), "French");
  assert.equal(languageInText("und die der das"), "German");
});

test("should not mistake arbitrary prefixes for a declaration or VTT text for cue content", () => {
  assert.equal(languageInText("prefixlanguage: en"), "");
  assert.equal(languageInText("XWEBVTT the and\n\n123"), "English");
  assert.equal(languageInText("WEBVTT the and\n\n123"), "");
});

test("should remove semantic markup and every supported cue-time shape before scoring", () => {
  assert.equal(languageInText("<i>the and</i>"), "English");

  assert.equal(
    languageInText(
      "1:02:03.004 --> 12:02:04.005 the and\n01:02.003 --> 01:03.004 the and",
    ),
    "",
  );
});
