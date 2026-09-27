import { z } from 'zod';

/** The five verdicts (brief 7). */
export const VERDICTS = [
  'stimmt',
  'groesstenteils_richtig',
  'uebertrieben',
  'falsch',
  'nicht_pruefbar',
] as const;

export const Verdict = z.enum(VERDICTS);
export type Verdict = z.infer<typeof Verdict>;

/** Derived from `confidence` with per-task thresholds (brief 8.1, ADR 0007). */
export const ConfidenceLevel = z.enum(['hoch', 'mittel', 'niedrig']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

/** Probabilities may carry rounding error from the classifier; beyond this they are wrong. */
export const PROBABILITY_SUM_TOLERANCE = 0.001;

const Probability = z.number().min(0).max(1);

/** A probability for every verdict, summing to 1 (ADR 0010). */
export const VerdictProbabilities = z
  .strictObject(
    Object.fromEntries(VERDICTS.map((verdict) => [verdict, Probability])) as Record<
      Verdict,
      typeof Probability
    >,
  )
  .refine(
    (probabilities) =>
      Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) <=
      PROBABILITY_SUM_TOLERANCE,
    { message: 'Probabilities must sum to 1' },
  );

export type VerdictProbabilities = z.infer<typeof VerdictProbabilities>;
