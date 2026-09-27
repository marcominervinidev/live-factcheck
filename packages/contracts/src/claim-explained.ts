import { z } from 'zod';

import { Uuid, text } from './common.js';

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

/**
 * A short German explanation of a verdict, published after `ClaimChecked` by the explainer
 * (brief 6a; ADR 0009, 0010). That it is German is a prompt rule, not checked here.
 */
export const ClaimExplained = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Uuid,
  claimId: Uuid,
  explanation: Explanation,
  provider: z.strictObject({ llm: text(64), model: text(128) }),
});

export type ClaimExplained = z.infer<typeof ClaimExplained>;
