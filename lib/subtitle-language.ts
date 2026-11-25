const LANGUAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pt: "Portuguese",
  "pt-br": "Portuguese (Brazil)",
  en: "English",
  "en-us": "English (US)",
  es: "Spanish",
  fr: "French",
  de: "German",
});

function languageLabel(code: string): string {
  const languageTag = code.toLowerCase().replace("_", "-");

  return LANGUAGE_LABELS[languageTag] || code;
}

/**
 * Infers a human language only after two or more language-specific signals.
 * This accepts UUID-named WebVTT tracks without adding unidentified tracks.
 */
export function languageInText(text: string): string {
  const declared = text.match(
    /(?:^|\n)\s*(?:language|lang)\s*[:=]\s*([a-z]{2}(?:[-_][a-z]{2})?)/i,
  );

  if (declared) return languageLabel(declared[1]);

  const words = ` ${text
    .replace(/^WEBVTT[^\n]*\n?/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?[\d:.,\s-]*-->.*/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()} `;

  const signals = Object.freeze({
    Portuguese: Object.freeze([
      " não ",
      " você ",
      " uma ",
      " também ",
      " então ",
      " gente ",
      " como ",
      " empresa ",
      " aula ",
      " à ",
      " para ",
      " com ",
      " que ",
      " isso ",
      " aqui ",
      " mais ",
      " muito ",
      " fazer ",
      " são ",
      " está ",
      " desenvolvimento ",
      " projeto ",
      " código ",
      " introdução ",
      " arquitetura ",
      " prática ",
      " módulo ",
    ]),
    English: Object.freeze([
      " the ",
      " and ",
      " you ",
      " with ",
      " this ",
      " that ",
      " what ",
      " are ",
      " from ",
      " have ",
      " they ",
      " your ",
      " about ",
    ]),
    Spanish: Object.freeze([
      " una ",
      " está ",
      " también ",
      " gracias ",
      " nosotros ",
      " ustedes ",
      " pero ",
      " porque ",
      " hola ",
    ]),
    French: Object.freeze([
      " vous ",
      " avec ",
      " une ",
      " est ",
      " merci ",
      " nous ",
      " dans ",
      " pour ",
    ]),
    German: Object.freeze([
      " und ",
      " die ",
      " der ",
      " das ",
      " ist ",
      " mit ",
      " nicht ",
      " wir ",
    ]),
  });

  const best = Object.entries(signals)
    .map(([language, matches]) => ({
      language,
      score: matches.reduce(
        (total, match) => total + (words.split(match).length - 1),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0];

  return best && best.score >= 2 ? best.language : "";
}
