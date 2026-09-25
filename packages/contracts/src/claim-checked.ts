import { z } from 'zod';

import { HttpUrl, IsoDateTimeUtc, Speaker, Uuid, text } from './common.js';

export const Verdict = z.enum([
  'stimmt',
  'groesstenteils_richtig',
  'uebertrieben',
  'falsch',
  'nicht_pruefbar',
]);
export type Verdict = z.infer<typeof Verdict>;

export const Confidence = z.enum(['hoch', 'mittel', 'niedrig']);
export type Confidence = z.infer<typeof Confidence>;

export const MAX_EXPLANATION_SENTENCES = 2;
export const MAX_EXPLANATION_LENGTH = 400;

// A sentence boundary is ., ! or ? followed by whitespace and an uppercase letter,
// unless the token before it is a number ("8. Mai") or a single letter ("z. B.").
// This undercounts rather than overcounts, so valid German explanations are not rejected.
const SENTENCE_BOUNDARY = /(?<!(?:^|[\s(])\p{L}|\d)[.!?]+\s+(?=\p{Lu})/gu;

export function countSentences(value: string): number {
  return (value.trim().match(SENTENCE_BOUNDARY) ?? []).length + 1;
}

export const Explanation = text(MAX_EXPLANATION_LENGTH).refine(
  (value) => countSentences(value) <= MAX_EXPLANATION_SENTENCES,
  { message: `At most ${String(MAX_EXPLANATION_SENTENCES)} sentences` },
);

export const Source = z.strictObject({
  title: text(300),
  url: HttpUrl,
  snippet: text(1_000).optional(),
});
export type Source = z.infer<typeof Source>;

export const ProviderInfo = z.strictObject({
  llm: text(64),
  model: text(128),
  search: text(64),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

/** The verdict on a claim. Every verdict except `nicht_pruefbar` must cite a source (brief 9.4). */
export const ClaimChecked = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: Uuid,
    claimId: Uuid,
    speaker: Speaker,
    claim: text(1_000),
    verdict: Verdict,
    confidence: Confidence,
    explanation: Explanation,
    sources: z.array(Source).max(10),
    checkedAt: IsoDateTimeUtc,
    provider: ProviderInfo,
  })
  .refine((checked) => checked.verdict === 'nicht_pruefbar' || checked.sources.length > 0, {
    message: 'A verdict other than nicht_pruefbar needs at least one source',
    path: ['sources'],
  });

export type ClaimChecked = z.infer<typeof ClaimChecked>;
