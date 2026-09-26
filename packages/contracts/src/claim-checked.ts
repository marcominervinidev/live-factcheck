import { z } from 'zod';

import { HttpUrl, IsoDateTimeUtc, Speaker, Uuid, text } from './common.js';
import { Evidence } from './evidence.js';
import { ConfidenceLevel, Verdict, VerdictProbabilities } from './verdict.js';

/** Which cache level answered (brief 9.5, 9.6; ADR 0008). */
export const CacheHit = z.enum(['none', 'verdict_exact', 'verdict_semantic', 'evidence_store']);
export type CacheHit = z.infer<typeof CacheHit>;

/** Why a claim is `nicht_pruefbar` (ADR 0010). */
export const UncheckableReason = z.enum([
  'classified_unverifiable',
  'low_confidence',
  'no_evidence',
  'budget_exceeded',
  'invalid_llm_output',
  'uncited_or_foreign_source',
  'provider_error',
]);
export type UncheckableReason = z.infer<typeof UncheckableReason>;

const Milliseconds = z.int().nonnegative();

export const CheckTimings = z
  .strictObject({
    detectMs: Milliseconds,
    retrieveMs: Milliseconds,
    classifyMs: Milliseconds,
    totalMs: Milliseconds,
  })
  .refine(
    (timings) =>
      timings.totalMs >= Math.max(timings.detectMs, timings.retrieveMs, timings.classifyMs),
    { message: 'totalMs must be at least every other timing', path: ['totalMs'] },
  );
export type CheckTimings = z.infer<typeof CheckTimings>;

export const CheckProvider = z.strictObject({
  classifier: text(64),
  model: text(128),
  search: text(64),
  embeddings: text(64),
});
export type CheckProvider = z.infer<typeof CheckProvider>;

/** Tokens across all model calls for one claim; `null` cost means the price is unknown. */
export const Usage = z.strictObject({
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
});
export type Usage = z.infer<typeof Usage>;

export const ExistingFactCheck = z.strictObject({
  publisher: text(200),
  url: HttpUrl,
  rating: text(200),
});
export type ExistingFactCheck = z.infer<typeof ExistingFactCheck>;

/**
 * The verdict on a claim, published before any explanation (brief 7, 9.6; ADR 0010).
 * The explanation arrives separately as `ClaimExplained`.
 */
export const ClaimChecked = z
  .strictObject({
    schemaVersion: z.literal(2),
    sessionId: Uuid,
    claimId: Uuid,
    speaker: Speaker,
    /** The claim's `standaloneText`. */
    claim: text(1_000),
    verdict: Verdict,
    probabilities: VerdictProbabilities,
    confidence: z.number().min(0).max(1),
    confidenceLevel: ConfidenceLevel,
    evidence: z.array(Evidence).max(10),
    bestEvidenceId: Uuid.optional(),
    cacheHit: CacheHit,
    existingFactCheck: ExistingFactCheck.optional(),
    timings: CheckTimings,
    checkedAt: IsoDateTimeUtc,
    provider: CheckProvider,
    usage: Usage,
    reason: UncheckableReason.optional(),
  })
  .superRefine((checked, ctx) => {
    const uncheckable = checked.verdict === 'nicht_pruefbar';
    if (!uncheckable && checked.evidence.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'A verdict other than nicht_pruefbar needs at least one evidence item',
      });
    }
    if (
      checked.bestEvidenceId !== undefined &&
      !checked.evidence.some((item) => item.evidenceId === checked.bestEvidenceId)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['bestEvidenceId'],
        message: 'bestEvidenceId must reference an item in evidence',
      });
    }
    if (uncheckable !== (checked.reason !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason is required for nicht_pruefbar and not allowed otherwise',
      });
    }
    if (!uncheckable) {
      const own = checked.probabilities[checked.verdict];
      if (Object.values(checked.probabilities).some((p) => p > own)) {
        ctx.addIssue({
          code: 'custom',
          path: ['verdict'],
          message: 'verdict must have the highest probability',
        });
      }
      if (checked.confidenceLevel === 'niedrig') {
        ctx.addIssue({
          code: 'custom',
          path: ['confidenceLevel'],
          message: 'a verdict with confidenceLevel niedrig must be nicht_pruefbar',
        });
      }
    }
    if (checked.reason === 'low_confidence' && checked.confidenceLevel !== 'niedrig') {
      ctx.addIssue({
        code: 'custom',
        path: ['confidenceLevel'],
        message: 'reason low_confidence requires confidenceLevel niedrig',
      });
    }
  });

export type ClaimChecked = z.infer<typeof ClaimChecked>;
