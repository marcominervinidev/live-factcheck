import { randomBytes, randomUUID } from 'node:crypto';

import type { ClaimDetected, TranscriptSegment } from '@lfc/contracts';
import { ClaimDetected as ClaimDetectedSchema, countSentences } from '@lfc/contracts';
import type {
  BoolQuestion,
  ClassifierProvider,
  DailyBudget,
  LlmProvider,
  PromptTemplate,
  ScoreQuestion,
} from '@lfc/providers';
import { BudgetExceededError, ClassifierError, LlmError, renderPrompt } from '@lfc/providers';
import { normalizeClaimText } from '@lfc/service-kit';
import { z } from 'zod';

import type { PrefilterReason } from './prefilter.js';
import { prefilter } from './prefilter.js';
import type { SessionStore, WindowSegment } from './store.js';

/** The two questions of ADR 0017, asked together in one classifier call. */
export const DETECTION_QUESTIONS = {
  claim: {
    type: 'bool',
    instructions:
      'Enthält die neueste Äußerung eine überprüfbare Tatsachenbehauptung – eine Aussage über Fakten, Zahlen, Ereignisse oder Zustände, die sich mit Quellen belegen oder widerlegen lässt? Meinungen, Wertungen, Fragen, Prognosen, Versprechen und Aufforderungen sind keine Tatsachenbehauptungen. Der Verlauf dient nur zum Verständnis von Bezügen.',
    criteria: {
      true: 'Die neueste Äußerung behauptet einen überprüfbaren Sachverhalt.',
      false: 'Die neueste Äußerung ist Meinung, Frage, Prognose, Smalltalk oder unverständlich.',
    },
  } satisfies BoolQuestion,
  checkworthiness: {
    type: 'score',
    instructions:
      'Wie prüfwürdig ist die Behauptung der neuesten Äußerung für ein allgemeines Publikum? Hoch: Zahlen, Statistiken, historische Fakten oder Aussagen über Politik, Gesundheit und Wirtschaft mit Tragweite. Niedrig: Belanglosigkeiten und Privates.',
    levels: [
      '1 – belanglos',
      '2 – kaum relevant',
      '3 – relevant',
      '4 – wichtig',
      '5 – sehr wichtig',
    ],
  } satisfies ScoreQuestion,
} as const;

/** Duplicate check for similar claims (brief 8.1: protects against other numbers or negation). */
export const SAME_CLAIM_QUESTION = {
  same: {
    type: 'bool',
    instructions:
      'Haben die beiden Behauptungen denselben Wahrheitsgehalt – ist die eine genau dann wahr, wenn die andere wahr ist? Unterschiedliche Zahlen, Zeitpunkte, Orte oder eine Verneinung bedeuten: nein.',
  } satisfies BoolQuestion,
} as const;

export const StandaloneAnswer = z.strictObject({
  standaloneText: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((value) => countSentences(value) === 1, { message: 'Exactly one sentence' }),
  originalText: z.string().trim().min(1).max(1_000),
});

export type DropReason =
  | PrefilterReason
  | 'not_a_claim'
  | 'uncertain'
  | 'low_checkworthiness'
  | 'duplicate'
  | 'invalid_llm_output'
  | 'refused'
  | 'budget_exceeded'
  | 'provider_error';

export type DetectOutcome =
  | { readonly kind: 'claim'; readonly claim: ClaimDetected }
  | { readonly kind: 'dropped'; readonly reason: DropReason };

export interface DetectDeps {
  readonly classifier: ClassifierProvider;
  readonly llm: LlmProvider;
  readonly prompt: PromptTemplate;
  readonly store: SessionStore;
  /** Present when the classifier or the LLM is a cloud service (brief 15.5). */
  readonly budget?: DailyBudget;
  readonly thresholds: { readonly high: number; readonly low: number };
  /** Minimum checkworthiness on the 1–5 scale. */
  readonly minScore: number;
  readonly minWords: number;
  readonly now: () => Date;
  /** Monotonic milliseconds, for `detectMs`. */
  readonly clock: () => number;
}

/** Token overlap of two claims (Jaccard over words with at least 3 characters). */
export function similarity(a: string, b: string): number {
  const tokens = (text: string) =>
    new Set(
      normalizeClaimText(text)
        .split(/[^\p{L}\p{N},]+/u)
        .filter((token) => token.length >= 3),
    );
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const SIMILAR = 0.6;

/** The classifier and LLM state: the window as context, the newest segment to judge. */
function stateOf(window: readonly WindowSegment[], newest: TranscriptSegment) {
  return {
    verlauf: window
      .filter((s) => s.segmentId !== newest.segmentId)
      .map((s) => ({ sprecher: s.speaker, text: s.text })),
    // Speakers are letters (A, B, …), never names: Jev runs in the US (brief 15.6, ADR 0017).
    neu: { sprecher: newest.speaker, text: newest.text },
  };
}

/**
 * Decides whether a final transcript segment holds a checkworthy factual claim and, if so, turns
 * it into a `ClaimDetected` (ADR 0017): pre-filter → classifier → standalone formulation →
 * deduplication. Never throws for model failures; they become a dropped outcome with a reason.
 */
export async function detectClaim(
  segment: TranscriptSegment,
  deps: DetectDeps,
): Promise<DetectOutcome> {
  const started = deps.clock();
  const window = await deps.store.addToWindow(segment);
  const filtered = prefilter(segment.text, { minWords: deps.minWords });
  if (!filtered.pass) return { kind: 'dropped', reason: filtered.reason };

  try {
    await deps.budget?.ensureAvailable();
    const state = stateOf(window, segment);
    const detection = await deps.classifier.ask(state, DETECTION_QUESTIONS);
    await deps.budget?.record(detection.model, detection.usage);
    const { claim, checkworthiness } = detection.answers;
    if (claim.probability < 0.5) return { kind: 'dropped', reason: 'not_a_claim' };
    // Precision first (ADR 0017): an uncertain "yes" is dropped, not shown.
    if (claim.confidence < deps.thresholds.high) return { kind: 'dropped', reason: 'uncertain' };
    const levels = DETECTION_QUESTIONS.checkworthiness.levels.length;
    if (checkworthiness.score + 1 < deps.minScore) {
      return { kind: 'dropped', reason: 'low_checkworthiness' };
    }

    const nonce = randomBytes(8).toString('hex');
    const formulated = await deps.llm.generateStructured({
      task: 'standalone',
      system: deps.prompt.system,
      user: renderPrompt(deps.prompt.user, { nonce, data: JSON.stringify(state, null, 2) }),
      schema: StandaloneAnswer,
      maxTokens: 400,
    });
    await deps.budget?.record(formulated.model, formulated.usage);
    const { standaloneText } = formulated.value;
    const normalizedText = normalizeClaimText(standaloneText) || standaloneText;

    if (await isDuplicate(segment.sessionId, standaloneText, normalizedText, deps)) {
      return { kind: 'dropped', reason: 'duplicate' };
    }
    await deps.store.addClaim(segment.sessionId, normalizedText, standaloneText);

    const claimDetected = ClaimDetectedSchema.parse({
      schemaVersion: 3,
      sessionId: segment.sessionId,
      claimId: randomUUID(),
      speaker: segment.speaker,
      originalText: formulated.value.originalText,
      standaloneText,
      normalizedText,
      checkworthiness: Math.min(1, Math.max(0, checkworthiness.score / (levels - 1))),
      sourceSegmentIds: [segment.segmentId],
      detectedAt: deps.now().toISOString(),
      // From receiving the final segment to the claim; STT finalisation is not included.
      detectMs: Math.max(0, Math.round(deps.clock() - started)),
      provider: { classifier: detection.provider, model: detection.model.slice(0, 128) },
    });
    return { kind: 'claim', claim: claimDetected };
  } catch (error) {
    return { kind: 'dropped', reason: reasonOf(error) };
  }
}

async function isDuplicate(
  sessionId: string,
  standaloneText: string,
  normalizedText: string,
  deps: DetectDeps,
): Promise<boolean> {
  if (await deps.store.hasClaim(sessionId, normalizedText)) return true;
  for (const earlier of await deps.store.recentClaims(sessionId)) {
    if (similarity(standaloneText, earlier) < SIMILAR) continue;
    // Similar wording: only the classifier can tell "1945" from "1965" or "ist" from "ist nicht".
    const same = await deps.classifier.ask({ a: earlier, b: standaloneText }, SAME_CLAIM_QUESTION);
    await deps.budget?.record(same.model, same.usage);
    if (
      same.answers.same.probability >= 0.5 &&
      same.answers.same.confidence >= deps.thresholds.high
    ) {
      return true;
    }
  }
  return false;
}

function reasonOf(error: unknown): DropReason {
  if (error instanceof BudgetExceededError) return 'budget_exceeded';
  if (error instanceof LlmError || error instanceof ClassifierError) {
    if (error.kind === 'invalid_output') return 'invalid_llm_output';
    if (error.kind === 'refused') return 'refused';
    return 'provider_error';
  }
  throw error;
}
