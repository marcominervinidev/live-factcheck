/**
 * Deterministic pre-filter against small talk (brief 8.1, ADR 0017): drops segments that cannot
 * hold a checkable claim before any model sees them. Precision of the whole detection matters
 * most, but the pre-filter must not drop real claims, so it only removes the obvious cases and
 * keeps everything that carries a "fact signal" (a number, a quantity, a comparison).
 * Being a question is no reason to drop: only the classifier tells a rhetorical question that
 * insinuates a fact from a genuine one, and a leading interrogative can open a claim ("Was uns
 * empört, ist …"). A filler opener does not drop a question either ("Also wer hat denn …?");
 * a question is recognised by its question mark. An opinion marker is no reason to drop
 * either: the classifier finds the fact inside "Ich finde es absurd, dass …" and rejects a pure
 * opinion itself (owner decisions 2026-10-02, ADR 0017).
 */

export type PrefilterReason = 'too_short' | 'greeting_or_filler';

export type PrefilterResult =
  { readonly pass: true } | { readonly pass: false; readonly reason: PrefilterReason };

// LANG-EN: all word lists below are German; English needs its own lists (ADR 0020)
const GREETING_OR_FILLER =
  /^(guten (morgen|tag|abend)|hallo|herzlich willkommen|willkommen|vielen dank|danke|tschüss|auf wiedersehen|ja|nein|okay|ok|genau|also|äh|ähm|hm)\b/i;

/** Numbers, quantities, comparisons and time spans: things a fact-checker can verify. */
const FACT_SIGNAL =
  /\d|\b(null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|dreißig|hundert|tausend|millionen?|milliarden?|prozent|hälfte|drittel|viertel|doppelt|dreimal|mehr als|weniger als|höher als|niedriger als|größer als|kleiner als|mehrheit|jahrhundert|jahrzehnt|seit)\b/i;

export interface PrefilterOptions {
  readonly minWords: number;
}

/**
 * Longer segments are cut before any pattern runs: the patterns are linear, and a bound keeps
 * the pre-filter's cost fixed whatever a speaker (or an attacker) produces.
 */
const MAX_CHARS = 2_000;

export function prefilter(text: string, options: PrefilterOptions): PrefilterResult {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- fixed alternations without nested or overlapping quantifiers (linear time), input bounded to MAX_CHARS
  const trimmed = text.slice(0, MAX_CHARS).trim();
  const words = trimmed.split(/\s+/).filter((word) => word !== '');
  if (words.length < options.minWords) return { pass: false, reason: 'too_short' };

  const factSignal = FACT_SIGNAL.test(trimmed);
  const question = trimmed.endsWith('?');
  if (!factSignal && !question && GREETING_OR_FILLER.test(trimmed)) {
    return { pass: false, reason: 'greeting_or_filler' };
  }
  return { pass: true };
}
