import type {
  ClaimChecked,
  ClaimDetected,
  Evidence,
  UncheckableReason,
  Verdict,
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
  EmbeddingError,
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

/** A corrupt cache entry counts as a miss instead of blocking the claim forever. */
function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const verdictCacheKey = (normalizedText: string) => `verdict:v1:${sha256(normalizedText)}`;

/** Sum of two costs; unknown (`null`) wins, so an unknown price is never shown as zero. */
function addCost(total: number | null, model: string, usage: TokenUsage): number | null {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return total;
  const cost = estimateCostUsd(model, usage);
  return total === null || cost === null ? null : total + cost;
}

/** ISO timestamp for a third-party date, or undefined when it is invalid or out of range. */
function isoDate(value: string | undefined): string | undefined {
  if (value === undefined || Number.isNaN(Date.parse(value))) return undefined;
  const iso = new Date(value).toISOString();
  return /^\d{4}-/.test(iso) ? iso : undefined;
}

function factCheckEvidence(hit: FactCheckHit, retrievedAt: string, evidenceId: string): Evidence {
  return {
    evidenceId,
    title: hit.title ?? hit.claimText,
    url: hit.url,
    publisher: hit.publisher,
    ...(isoDate(hit.reviewDate) === undefined ? {} : { publishedAt: isoDate(hit.reviewDate) }),
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

/** Fact-check hits shown to the classifier; the first one becomes `existingFactCheck`. */
const MAX_FACT_CHECKS = 3;
/** Keeps one long page from filling every top-k slot. */
const MAX_CHUNKS_PER_DOCUMENT = 6;
/** The contract's maximum for `ClaimChecked.evidence`. */
const MAX_EVIDENCE = 10;
const QUERIES_MAX_TOKENS = 256;
const RELEVANT = 0.5;
const SUFFICIENT = 0.5;

const withSignal = (signal: AbortSignal | undefined) => (signal === undefined ? {} : { signal });

/** Tokens and cost of one check; every model call is also recorded against the daily budget. */
class Spending {
  usage: TokenUsage = NO_USAGE;
  /** `null` once any call had an unknown price, so it is never shown as zero. */
  costUsd: number | null = 0;

  constructor(private readonly budget: DailyBudget | undefined) {}

  async add(model: string, spent: TokenUsage): Promise<void> {
    this.usage = addUsage(this.usage, spent);
    this.costUsd = addCost(this.costUsd, model, spent);
    await this.budget?.record(model, spent);
  }
}

type VerdictFields = Pick<
  ClaimChecked,
  'verdict' | 'probabilities' | 'confidence' | 'confidenceLevel' | 'evidence'
> &
  Partial<Pick<ClaimChecked, 'bestEvidenceId' | 'existingFactCheck' | 'reason' | 'cacheHit'>>;

type Classification =
  | { readonly kind: 'uncheckable'; readonly reason: UncheckableReason }
  | { readonly kind: 'judged'; readonly fields: VerdictFields };

interface Findings {
  readonly ranked: readonly RankedChunk[];
  readonly factChecks: readonly FactCheckHit[];
  readonly retrievedAt: string;
}

/** Step 1 (ADR 0008): a valid cached verdict for exactly this normalized text, if any. */
async function readCachedVerdict(
  detected: ClaimDetected,
  deps: PipelineDeps,
): Promise<ClaimChecked | undefined> {
  const cached = CachedVerdict.safeParse(
    parseJson(await deps.verdictCache.get(verdictCacheKey(detected.normalizedText))),
  );
  if (!cached.success) return undefined;
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
  return candidate.success ? candidate.data : undefined;
}

/** Only real verdicts are cached, without anything that belongs to one claim instance. */
async function writeCachedVerdict(
  detected: ClaimDetected,
  result: ClaimChecked,
  deps: PipelineDeps,
): Promise<void> {
  await deps.verdictCache.set(
    verdictCacheKey(detected.normalizedText),
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
}

/**
 * Heuristic queries when the LLM fails (brief 8.1): the claim itself plus its names and numbers
 * (capitalised words not at the start of the sentence, and digits), which search engines match
 * better than a full German sentence.
 */
export function fallbackQueries(claim: string): readonly string[] {
  const words = claim
    .replace(/[.!?,;:„“"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const entities = words.filter((word, i) => (i > 0 && /^\p{Lu}/u.test(word)) || /\d/.test(word));
  const keywords = entities.join(' ');
  return keywords !== '' && keywords !== claim ? [claim, keywords] : [claim];
}

/** Step 3: search queries from the LLM; if it fails, the claim itself is the query. */
async function generateQueries(
  claim: string,
  deps: PipelineDeps,
  spending: Spending,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  try {
    const result = await deps.llm.generateStructured(
      {
        task: 'queries',
        system: deps.queriesPrompt.system,
        user: renderPrompt(deps.queriesPrompt.user, { claim }),
        schema: Queries,
        maxTokens: QUERIES_MAX_TOKENS,
      },
      withSignal(signal),
    );
    await spending.add(result.model, result.usage);
    return result.value.queries;
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    await spending.add(deps.llm.model, error.usage);
    return fallbackQueries(claim);
  }
}

/** Step 4 (brief 9.1–9.3): live research over the three tiers, then in-memory ranking. */
async function gatherFindings(
  claim: string,
  queries: readonly string[],
  deps: PipelineDeps,
  signal: AbortSignal | undefined,
): Promise<Findings> {
  const research = await deps.research({ claim, queries }, signal);
  const ranked = await rankChunks(claim, research.documents, deps.embeddings, {
    topK: deps.topK,
    maxChunksPerDocument: MAX_CHUNKS_PER_DOCUMENT,
    ...withSignal(signal),
  });
  return {
    ranked,
    factChecks: research.factChecks.slice(0, MAX_FACT_CHECKS),
    retrievedAt: deps.now().toISOString(),
  };
}

/**
 * Step 5: relevance of each snippet, then sufficiency, verdict and best snippet, then the
 * thresholds. The classifier sees snippets only as data under our own keys (`S1…`, `F1…`).
 */
async function classify(
  claim: string,
  findings: Findings,
  deps: PipelineDeps,
  spending: Spending,
  signal: AbortSignal | undefined,
): Promise<Classification> {
  const { ranked, factChecks, retrievedAt } = findings;
  const snippetKeys = ranked.map((_, i) => `S${String(i + 1)}`);
  const factCheckKeys = factChecks.map((_, i) => `F${String(i + 1)}`);
  const snippets = Object.fromEntries(
    ranked.map((chunk, i) => [
      snippetKeys[i] ?? '',
      { publisher: chunk.document.publisher, tier: chunk.document.tier, text: chunk.text },
    ]),
  );
  const existingFactChecks = Object.fromEntries(
    factChecks.map((hit, i) => [
      factCheckKeys[i] ?? '',
      { publisher: hit.publisher, claim: hit.claimText, rating: hit.rating },
    ]),
  );

  try {
    const relevance =
      ranked.length === 0
        ? undefined
        : await deps.classifier.ask(
            { claim, snippets, existingFactChecks },
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
            withSignal(signal),
          );
    if (relevance !== undefined) await spending.add(relevance.model, relevance.usage);
    const relevantKeys = snippetKeys.filter(
      (key) => (relevance?.answers[key]?.probability ?? 0) >= RELEVANT,
    );

    const evidenceByKey = new Map<string, Evidence>();
    for (const key of relevantKeys) {
      const chunk = ranked[snippetKeys.indexOf(key)];
      if (chunk !== undefined) evidenceByKey.set(key, chunkEvidence(chunk));
    }
    factChecks.forEach((hit, i) =>
      evidenceByKey.set(
        factCheckKeys[i] ?? '',
        factCheckEvidence(hit, retrievedAt, crypto.randomUUID()),
      ),
    );
    if (evidenceByKey.size === 0) return { kind: 'uncheckable', reason: 'no_evidence' };

    const decision = await deps.classifier.ask(
      {
        claim,
        snippets: Object.fromEntries(
          relevantKeys.flatMap((key) => {
            const snippet = snippets[key];
            return snippet === undefined ? [] : [[key, snippet] as const];
          }),
        ),
        existingFactChecks,
      },
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
      withSignal(signal),
    );
    await spending.add(decision.model, decision.usage);
    return {
      kind: 'judged',
      fields: toVerdictFields(decision.answers, evidenceByKey, factChecks[0], deps.thresholds),
    };
  } catch (error) {
    if (!(error instanceof ClassifierError)) throw error;
    await spending.add(deps.classifier.model, error.usage);
    return {
      kind: 'uncheckable',
      reason: error.kind === 'invalid_output' ? 'invalid_llm_output' : 'provider_error',
    };
  }
}

/**
 * The chosen best item first, then fact checks, then snippets, so the cut to the contract's
 * maximum can never drop the item `bestEvidenceId` points to or the existing fact check.
 */
function orderEvidence(evidenceByKey: ReadonlyMap<string, Evidence>, bestKey: string): Evidence[] {
  const rank = (key: string) => (key === bestKey ? 0 : key.startsWith('F') ? 1 : 2);
  return [...evidenceByKey.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([, item]) => item);
}

/** Applies sufficiency and the confidence thresholds (brief 8.1) to the classifier's answers. */
function toVerdictFields(
  answers: {
    readonly sufficient: { readonly probability: number };
    readonly verdict: {
      readonly choice: Verdict;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    };
    readonly best: { readonly choice: string };
  },
  evidenceByKey: ReadonlyMap<string, Evidence>,
  topFactCheck: FactCheckHit | undefined,
  thresholds: PipelineDeps['thresholds'],
): VerdictFields {
  const { verdict: answer, sufficient, best } = answers;
  const level = confidenceLevel(answer.confidence, thresholds);
  const bestEvidenceId = evidenceByKey.get(best.choice)?.evidenceId;
  const base = {
    probabilities: answer.probabilities as VerdictProbabilities,
    confidence: answer.confidence,
    confidenceLevel: level,
    evidence: orderEvidence(evidenceByKey, best.choice).slice(0, MAX_EVIDENCE),
    ...(topFactCheck === undefined
      ? {}
      : {
          existingFactCheck: {
            publisher: topFactCheck.publisher,
            url: topFactCheck.url,
            rating: topFactCheck.rating,
          },
        }),
  };

  let reason: UncheckableReason | undefined;
  if (sufficient.probability < SUFFICIENT) reason = 'no_evidence';
  else if (answer.choice === 'nicht_pruefbar') reason = 'classified_unverifiable';
  else if (level === 'niedrig') reason = 'low_confidence';

  if (reason !== undefined) {
    // classified_unverifiable keeps its level (how sure the classifier is that the claim cannot
    // be checked); without sufficient evidence or with low confidence the level is niedrig.
    return {
      ...base,
      verdict: 'nicht_pruefbar',
      confidenceLevel: reason === 'classified_unverifiable' ? level : 'niedrig',
      reason,
    };
  }
  return {
    ...base,
    verdict: answer.choice,
    ...(bestEvidenceId === undefined ? {} : { bestEvidenceId }),
  };
}

/**
 * Checks one claim (brief 9.6): verdict cache → budget → search queries → live research →
 * relevance → sufficiency → verdict. Every failure ends as `nicht_pruefbar` with a reason, never
 * as a crash (brief 8); only infrastructure errors throw, so the stream message is retried.
 * The classifier can only pick among our own evidence keys, so no foreign source can be cited
 * (brief 15.5).
 */
export async function checkClaim(
  detected: ClaimDetected,
  deps: PipelineDeps,
  signal?: AbortSignal,
): Promise<ClaimChecked> {
  const started = deps.clock();
  const claim = detected.standaloneText;
  const spending = new Spending(deps.budget);
  const timings = { retrieveMs: 0, classifyMs: 0 };

  const currentProvider = {
    classifier: deps.classifier.name,
    model: deps.classifier.model.slice(0, 128),
    search: deps.searchName,
    embeddings: deps.embeddings.name,
  };
  const finish = (
    fields: VerdictFields,
    // A cached verdict keeps the provider that produced it (eval provider comparison).
    provider: ClaimChecked['provider'] = currentProvider,
  ): ClaimChecked => {
    const totalMs = Math.max(0, Math.round(deps.clock() - started));
    return ClaimCheckedSchema.parse({
      schemaVersion: 2,
      sessionId: detected.sessionId,
      claimId: detected.claimId,
      speaker: detected.speaker,
      claim,
      cacheHit: 'none',
      ...fields,
      timings: {
        detectMs: 0,
        retrieveMs: Math.min(Math.round(timings.retrieveMs), totalMs),
        classifyMs: Math.min(Math.round(timings.classifyMs), totalMs),
        totalMs,
      },
      checkedAt: deps.now().toISOString(),
      provider,
      usage: { ...spending.usage, estimatedCostUsd: spending.costUsd },
    });
  };
  const uncheckable = (reason: UncheckableReason) =>
    finish({
      verdict: 'nicht_pruefbar',
      probabilities: UNIFORM,
      confidence: 0,
      confidenceLevel: 'niedrig',
      evidence: [],
      reason,
    });

  // 1. Exact verdict cache (ADR 0008).
  const cached = await readCachedVerdict(detected, deps);
  if (cached !== undefined)
    return finish({ ...cached, cacheHit: 'verdict_exact' }, cached.provider);

  // 2. Budget for cloud calls (brief 15.5).
  try {
    await deps.budget?.ensureAvailable();
  } catch (error) {
    if (error instanceof BudgetExceededError) return uncheckable('budget_exceeded');
    throw error;
  }

  // 3.–4. Search queries, research and ranking.
  const retrieveStart = deps.clock();
  const queries = await generateQueries(claim, deps, spending, signal);
  let findings: Findings;
  try {
    findings = await gatherFindings(claim, queries, deps, signal);
  } catch (error) {
    // Embedding provider down or the check's time budget used up: an answer, not a retry.
    if (!(error instanceof EmbeddingError) && signal?.aborted !== true) throw error;
    timings.retrieveMs = deps.clock() - retrieveStart;
    return uncheckable('provider_error');
  }
  timings.retrieveMs = deps.clock() - retrieveStart;
  if (findings.ranked.length === 0 && findings.factChecks.length === 0) {
    return uncheckable('no_evidence');
  }

  // 5. Classifier and thresholds.
  const classifyStart = deps.clock();
  const outcome = await classify(claim, findings, deps, spending, signal);
  timings.classifyMs = deps.clock() - classifyStart;
  if (outcome.kind === 'uncheckable') return uncheckable(outcome.reason);

  const result = finish(outcome.fields);
  if (result.verdict !== 'nicht_pruefbar') await writeCachedVerdict(detected, result, deps);
  return result;
}
