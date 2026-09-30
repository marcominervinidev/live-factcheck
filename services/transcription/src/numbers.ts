/**
 * German number words in speech-to-text output become digits (1945 instead of
 * "neunzehnhundertfünfundvierzig"): Deepgram's `smart_format` converts many numbers but not
 * German year forms, and the pipeline downstream – pre-filter, deduplication, search queries –
 * works with digits. Small numbers (up to twelve) stay words, as in written German; otherwise
 * every "eine Frage" would become "1 Frage".
 */

const UNITS: Readonly<Record<string, number>> = {
  ein: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
};

/** Numbers below 100 with an irregular or single-word form. */
const WORDS_BELOW_100: Readonly<Record<string, number>> = {
  ...UNITS,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
  dreißig: 30,
  dreissig: 30,
  vierzig: 40,
  fünfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
};

const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

/** 1–99: a single word ("sechzehn") or unit + "und" + tens ("achtundsechzig"). */
function below100(word: string): number | undefined {
  const direct = WORDS_BELOW_100[word];
  if (direct !== undefined) return direct;
  const at = word.indexOf('und');
  if (at <= 0) return undefined;
  const unit = UNITS[word.slice(0, at)];
  const tens = WORDS_BELOW_100[word.slice(at + 3)];
  return unit !== undefined && tens !== undefined && TENS.has(tens) ? unit + tens : undefined;
}

/** Splits at the first `marker`: [multiplier]marker[rest], each part optional. */
function scaled(
  word: string,
  marker: string,
  factor: number,
  multiplier: (part: string) => number | undefined,
  rest: (part: string) => number | undefined,
): number | undefined {
  const at = word.indexOf(marker);
  if (at < 0) return rest(word);
  const left = word.slice(0, at);
  const right = word.slice(at + marker.length);
  const times = left === '' ? 1 : multiplier(left);
  const plus = right === '' ? 0 : rest(right);
  return times === undefined || plus === undefined ? undefined : times * factor + plus;
}

/** 1–9999 in the "hundert" form; the multiplier may be up to 99 ("neunzehnhundert"). */
const below10000 = (word: string) => scaled(word, 'hundert', 100, below100, below100);

/** The value of one German number word up to 999 999, or undefined when it is none. */
export function parseGermanNumber(word: string): number | undefined {
  const lower = word.toLowerCase();
  if (lower === '') return undefined;
  return scaled(lower, 'tausend', 1_000, below10000, below10000);
}

/** Replaces German number words above twelve, and every hundert/tausend form, with digits. */
export function germanNumberWordsToDigits(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    const value = parseGermanNumber(word);
    if (value === undefined) return word;
    const compound = /hundert|tausend/i.test(word);
    return value > 12 || compound ? String(value) : word;
  });
}
