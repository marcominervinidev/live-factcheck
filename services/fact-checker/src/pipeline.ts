import type {
  ClaimChecked,
  ClaimDetected,
  Evidence,
  UncheckableReason,
  VerdictProbabilities,
} from '@lfc/contracts';
import { ClaimChecked as ClaimCheckedSchema, VERDICTS } from '@lfc/contracts';
import type {
  ClassifierProvider,
  DailyBudget,
  EmbeddingProvider,
  LlmProvider,
  PromptTemplate,
  TokenUsage,
} from '@lfc/providers';
import {
  BudgetExceededError,
  ClassifierError,
  LlmError,
  NO_USAGE,
  addUsage,
  confidenceLevel,
  estimateCostUsd,
  renderPrompt,
} from '@lfc/providers';
import type { FactCheckHit, RankedChunk, ResearchResult, TextCache } from '@lfc/research';
import { rankChunks, sha256, toSnippet } from '@lfc/research';
import { z } from 'zod';

import type { QuestionTexts } from './questions.js';

export interface PipelineDeps {
  readonly llm: LlmProvider;
  readonly classifier: ClassifierProvider;
  readonly thresholds: { readonly high: number; readonly low: number };
  readonly research: (
    input: { readonly claim: string; readonly queries: readonly string[] },
    signal?: AbortSignal,
  ) => Promise<ResearchResult>;
  readonly embeddings: EmbeddingProvider;
  readonly searchName: string;
  readonly verdictCache: TextCache;
  readonly verdictCacheTtlS: number;
  /** Present when a cloud model is configured; local-only setups have no budget (brief 15.5). */
  readonly budget?: DailyBudget;
  readonly topK: number;
  readonly queriesPrompt: PromptTemplate;
  readonly questions: QuestionTexts;
  readonly now: () => Date;
  readonly clock: () => number;
}

const Queries = z.strictObject({
  queries: z.array(z.string().trim().min(3).max(120)).min(1).max(3),
});

/** The verdict-cache entry: everything of a verdict that does not belong to one claim instance. */
const CachedVerdict = z.object({
  verdict: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
  confidenceLevel: z.string(),
  evidence: z.array(z.unknown()),
  bestEvidenceId: z.string().optional(),
  existingFactCheck: z.unknown().optional(),
  provider: z.unknown(),
});

export const verdictCacheKey = (normalizedText: string) => `verdict:v1:${sha256(normalizedText)}`;

/** Sum of two costs; unknown (`null`) wins, so an unknown price is never shown as zero. */
function addCost(total: number | null, model: string, usage: TokenUsage): number | null {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return total;
  const cost = estimateCostUsd(model, usage);
  return total === null || cost === null ? null : total + cost;
}

function factCheckEvidence(hit: FactCheckHit, retrievedAt: string, evidenceId: string): Evidence {
  return {
    evidenceId,
    title: hit.title ?? hit.claimText,
    url: hit.url,
    publisher: hit.publisher,
    ...(hit.reviewDate === undefined || Number.isNaN(Date.parse(hit.reviewDate))
      ? {}
      : { publishedAt: new Date(hit.reviewDate).toISOString() }),
    retrievedAt,
    tier: 'faktencheck',
    snippet: toSnippet(`${hit.claimText} – Bewertung: ${hit.rating}`),
  };
}

function chunkEvidence(chunk: RankedChunk): Evidence {
  return {
    evidenceId: chunk.id,
    title: chunk.document.title.slice(0, 300),
    url: chunk.document.url,
    publisher: chunk.document.publisher.slice(0, 200),
    ...(chunk.document.publishedAt === undefined
      ? {}
      : { publishedAt: chunk.document.publishedAt }),
    retrievedAt: chunk.document.retrievedAt,
    tier: chunk.document.tier,
    snippet: toSnippet(chunk.text),
  };
}

const UNIFORM: VerdictProbabilities = Object.fromEntries(
  VERDICTS.map((v) => [v, 1 / VERDICTS.length]),
) as VerdictProbabilities;

/**
 * Checks one claim (brief 9.6): verdict cache → live research → relevance → sufficiency →
 * verdict. Every failure ends as `nicht_pruefbar` with a reason, never as a crash (brief 8).
 * Snippets reach the classifier only as data; the classifier can only pick among our own
 * evidence ids, so no foreign source can be cited (brief 15.5).
 */
export async function checkClaim(
  detected: ClaimDetected,
  deps: PipelineDeps,
  signal?: AbortSignal,
): Promise<ClaimChecked> {
  const started = deps.clock();
  let usage: TokenUsage = NO_USAGE;
  let cost: number | null = 0;
  let retrieveMs = 0;
  let classifyMs = 0;
  const provider = {
    classifier: deps.classifier.name,
    model: deps.classifier.model.slice(0, 128),
    search: deps.searchName,
    embeddings: deps.embeddings.name,
  };

  const finish = (
    fields: Pick<
      ClaimChecked,
      'verdict' | 'probabilities' | 'confidence' | 'confidenceLevel' | 'evidence'
    > &
      Partial<Pick<ClaimChecked, 'bestEvidenceId' | 'existingFactCheck' | 'reason' | 'cacheHit'>>,
  ): ClaimChecked => {
    const totalMs = Math.max(0, Math.round(deps.clock() - started));
    return ClaimCheckedSchema.parse({
      schemaVersion: 2,
      sessionId: detected.sessionId,
      claimId: detected.claimId,
      speaker: detected.speaker,
      claim: detected.standaloneText,
      cacheHit: 'none',
      ...fields,
      timings: {
        detectMs: 0,
        retrieveMs: Math.min(Math.round(retrieveMs), totalMs),
        classifyMs: Math.min(Math.round(classifyMs), totalMs),
        totalMs,
      },
      checkedAt: deps.now().toISOString(),
      provider,
      usage: { ...usage, estimatedCostUsd: cost },
    });
  };
  const uncheckable = (reason: UncheckableReason, evidence: Evidence[] = []) =>
    finish({
      verdict: 'nicht_pruefbar',
      probabilities: UNIFORM,
      confidence: 0,
      confidenceLevel: 'niedrig',
      evidence,
      reason,
    });

  // 1. Exact verdict cache (ADR 0008).
  const cacheKey = verdictCacheKey(detected.normalizedText);
  const cached = CachedVerdict.safeParse(
    JSON.parse((await deps.verdictCache.get(cacheKey)) ?? 'null'),
  );
  if (cached.success) {
    const candidate = ClaimCheckedSchema.safeParse({
      ...cached.data,
      schemaVersion: 2,
      sessionId: detected.sessionId,
      claimId: detected.claimId,
      speaker: detected.speaker,
      claim: detected.standaloneText,
      cacheHit: 'verdict_exact',
      timings: { detectMs: 0, retrieveMs: 0, classifyMs: 0, totalMs: 0 },
      checkedAt: deps.now().toISOString(),
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    });
    if (candidate.success) {
      return finish({ ...candidate.data, cacheHit: 'verdict_exact' });
    }
  }

  // 2. Budget for cloud calls (brief 15.5).
  try {
    await deps.budget?.ensureAvailable();
  } catch (error) {
    if (error instanceof BudgetExceededError) return uncheckable('budget_exceeded');
    throw error;
  }

  const spend = async (model: string, spent: TokenUsage) => {
    usage = addUsage(usage, spent);
    cost = addCost(cost, model, spent);
    await deps.budget?.record(model, spent);
  };

  // 3. Search queries (LLM, heuristic fallback: the claim itself).
  const retrieveStart = deps.clock();
  let queries: string[] = [detected.standaloneText];
  try {
    const result = await deps.llm.generateStructured(
      {
        task: 'queries',
        system: deps.queriesPrompt.system,
        user: renderPrompt(deps.queriesPrompt.user, { claim: detected.standaloneText }),
        schema: Queries,
        maxTokens: 256,
      },
      signal === undefined ? {} : { signal },
    );
    queries = result.value.queries;
    await spend(result.model, result.usage);
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    await spend(deps.llm.model, error.usage);
  }

  // 4. Live research over the three tiers, then in-memory ranking (brief 9.1–9.3).
  const research = await deps.research({ claim: detected.standaloneText, queries }, signal);
  const ranked = await rankChunks(detected.standaloneText, research.documents, deps.embeddings, {
    topK: deps.topK,
    maxChunksPerDocument: 6,
    ...(signal === undefined ? {} : { signal }),
  });
  retrieveMs = deps.clock() - retrieveStart;

  const retrievedAt = deps.now().toISOString();
  const factChecks = research.factChecks.slice(0, 3);
  const factCheckIds = factChecks.map((_, i) => `F${String(i + 1)}`);
  const existingFactCheck =
    factChecks[0] === undefined
      ? undefined
      : {
          publisher: factChecks[0].publisher,
          url: factChecks[0].url,
          rating: factChecks[0].rating,
        };

  if (ranked.length === 0 && factChecks.length === 0) {
    return uncheckable('no_evidence');
  }

  // 5. Classifier: relevance of each snippet, then sufficiency, verdict and best snippet.
  const classifyStart = deps.clock();
  const snippetKeys = ranked.map((_, i) => `S${String(i + 1)}`);
  const snippets: Record<string, { publisher: string; tier: string; text: string }> = {};
  ranked.forEach((chunk, i) => {
    snippets[snippetKeys[i] ?? ''] = {
      publisher: chunk.document.publisher,
      tier: chunk.document.tier,
      text: chunk.text,
    };
  });
  const existingFactChecks: Record<string, { publisher: string; claim: string; rating: string }> =
    {};
  factChecks.forEach((hit, i) => {
    existingFactChecks[factCheckIds[i] ?? ''] = {
      publisher: hit.publisher,
      claim: hit.claimText,
      rating: hit.rating,
    };
  });
  const state = { claim: detected.standaloneText, snippets, existingFactChecks };

  try {
    const relevance =
      ranked.length === 0
        ? undefined
        : await deps.classifier.ask(
            state,
            Object.fromEntries(
              snippetKeys.map((key) => [
                key,
                {
                  type: 'bool' as const,
                  instructions: deps.questions.relevance.instructions.replaceAll('{{id}}', key),
                  criteria: deps.questions.relevance.criteria,
                },
              ]),
            ),
            signal === undefined ? {} : { signal },
          );
    if (relevance !== undefined) await spend(relevance.model, relevance.usage);
    const relevant = ranked.filter(
      (_, i) => (relevance?.answers[snippetKeys[i] ?? '']?.probability ?? 0) >= 0.5,
    );

    const evidenceByKey = new Map<string, Evidence>();
    relevant.forEach((chunk) =>
      evidenceByKey.set(snippetKeys[ranked.indexOf(chunk)] ?? '', chunkEvidence(chunk)),
    );
    factChecks.forEach((hit, i) =>
      evidenceByKey.set(
        factCheckIds[i] ?? '',
        factCheckEvidence(hit, retrievedAt, crypto.randomUUID()),
      ),
    );
    const evidence = [...evidenceByKey.values()].slice(0, 10);
    if (evidenceByKey.size === 0) {
      classifyMs = deps.clock() - classifyStart;
      return uncheckable('no_evidence');
    }

    const relevantSnippets: typeof snippets = {};
    for (const chunk of relevant) {
      const key = snippetKeys[ranked.indexOf(chunk)] ?? '';
      const snippet = snippets[key];
      if (snippet !== undefined) relevantSnippets[key] = snippet;
    }
    const verdictState = { claim: state.claim, snippets: relevantSnippets, existingFactChecks };
    const decision = await deps.classifier.ask(
      verdictState,
      {
        sufficient: {
          type: 'bool',
          instructions: deps.questions.sufficient.instructions,
          criteria: deps.questions.sufficient.criteria,
        },
        verdict: {
          type: 'choice',
          instructions: deps.questions.verdict.instructions,
          options: deps.questions.verdict.options,
        },
        best: {
          type: 'choice',
          instructions: deps.questions.best.instructions,
          options: Object.fromEntries([...evidenceByKey.keys()].map((key) => [key, null])),
        },
      },
      signal === undefined ? {} : { signal },
    );
    await spend(decision.model, decision.usage);
    classifyMs = deps.clock() - classifyStart;

    const { verdict: verdictAnswer, sufficient, best } = decision.answers;
    const probabilities = verdictAnswer.probabilities as VerdictProbabilities;
    const confidence = verdictAnswer.confidence;
    const level = confidenceLevel(confidence, deps.thresholds);
    const bestEvidenceId = evidenceByKey.get(best.choice)?.evidenceId;
    const base = {
      probabilities,
      confidence,
      confidenceLevel: level,
      evidence,
      ...(existingFactCheck === undefined ? {} : { existingFactCheck }),
    };

    let reason: UncheckableReason | undefined;
    if (sufficient.probability < 0.5) reason = 'no_evidence';
    else if (verdictAnswer.choice === 'nicht_pruefbar') reason = 'classified_unverifiable';
    else if (level === 'niedrig') reason = 'low_confidence';

    if (reason !== undefined) {
      // low_confidence keeps its real level; the other reasons are reported without a level claim.
      return finish({
        ...base,
        verdict: 'nicht_pruefbar',
        confidenceLevel: reason === 'low_confidence' ? 'niedrig' : level,
        reason,
      });
    }

    const result = finish({
      ...base,
      verdict: verdictAnswer.choice,
      ...(bestEvidenceId === undefined ? {} : { bestEvidenceId }),
    });
    await deps.verdictCache.set(
      cacheKey,
      JSON.stringify({
        verdict: result.verdict,
        probabilities: result.probabilities,
        confidence: result.confidence,
        confidenceLevel: result.confidenceLevel,
        evidence: result.evidence,
        ...(result.bestEvidenceId === undefined ? {} : { bestEvidenceId: result.bestEvidenceId }),
        ...(result.existingFactCheck === undefined
          ? {}
          : { existingFactCheck: result.existingFactCheck }),
        provider: result.provider,
      }),
      deps.verdictCacheTtlS,
    );
    return result;
  } catch (error) {
    classifyMs = deps.clock() - classifyStart;
    if (error instanceof ClassifierError) {
      await spend(deps.classifier.model, error.usage);
      return uncheckable(error.kind === 'invalid_output' ? 'invalid_llm_output' : 'provider_error');
    }
    throw error;
  }
}
