# 0007: Classifier architecture – Jev with an LLM fallback

- Status: accepted
- Date: 2026-09-26

## Context

Most decisions in the pipeline are classifications, not text tasks (brief 8.1): is a segment check-worthy, is a snippet relevant, is the evidence sufficient, which verdict, which snippet supports it best, do two claims have the same truth value. Brief 7 wants a probability distribution over the verdicts and a confidence, and brief 11 wants honest uncertainty ("unsicher") instead of colour.

TypeSafe's Jev is built for exactly this: typed questions (`choice`, `score`, `noul`) against a `state`, answers with probabilities and a derived confidence, no text generation (`.ai/research/classifier-jev.md`). But Jev is early access with a waitlist, hosted in the US without an EU region, trained primarily on English, weak at numbers and date comparison by its own documentation, and has a 32k/64k token budget. The pipeline must work fully without it, including a completely local mode (brief 8.1, 15.6).

## Decision

**Interface** in `packages/providers` (`src/classifier/`):

```ts
interface ClassifierProvider {
  ask<Q extends Questions>(state: ClassifierState, questions: Q, options?: { signal?: AbortSignal }):
    Promise<{ answers: AnswersFor<Q>; usage: Usage; model: string; provider: ClassifierName }>;
}
// Question: { type: 'choice', instructions, options: Record<string, string | null> }
//         | { type: 'score', instructions, levels: string[] }       // 2..10 ordered levels
//         | { type: 'bool', instructions, criteria?: { true, false } }
// Every answer: { probabilities: Record<option|level|'true'|'false', number>, confidence: number }
//   plus choice → { choice }, score → { score }, bool → { probability }
```

- Several questions per call (Jev evaluates them in parallel against one state; the `llm` provider bundles them into one zod schema). Our question ids never reach the model.
- **Confidence is computed the same way for every provider**: `clamp((n·p_max − 1)/(n − 1), 0, 1)` over the answer's distribution (Jev's documented definition; for `bool` n = 2). Jev's own `confidence` uses the same definition; we still recompute it from Jev's probabilities, so all providers share one implementation and eval results are comparable (clarified 2026-09-26 during implementation).
- **Implementations:** `llm` (default; uses the task's `LlmProvider`, asks for a probability per option, validates with zod, normalises to sum 1, rejects sums outside 0.9–1.1 with one repair attempt), `mock` (deterministic, fixtures), `typesafe` (official SDK `@typesafe-ai/sdk`, pinned; key passed explicitly from config; SDK logging off except warnings without bodies; timeout and retries from config). Phase 7 may add `local-model`.
- **Configuration per task** (brief 8.1): `CHECKER_CLASSIFIER_PROVIDER` (`llm` | `typesafe` | `mock`), `CHECKER_CLASSIFIER_MODEL` (Jev: a pinned version such as `jev-1.13.0`, never the moving alias, because thresholds are tuned per version), `CHECKER_CONFIDENCE_HIGH` and `CHECKER_CONFIDENCE_LOW` (start 0.75 / 0.45, tuned by the eval). `DETECTOR_*` follows in phase 2. `typesafe` requires `TYPESAFE_API_KEY` (secret); the `llm` classifier reuses `<TASK>_LLM_*`.
- **Thresholds:** confidence ≥ HIGH → `hoch`, act; ≥ LOW → `mittel`, shown as "unsicher"; below → `niedrig`, the verdict becomes `nicht_pruefbar` (the distribution is still published).
- **Privacy (brief 15.6):** only the needed text goes to Jev (claim, snippets); speaker names are replaced by placeholders (`A`, `B`, …) before any classifier call. `PRIVACY_MODE=local` makes every worker refuse to start when a cloud provider is configured (Anthropic, TypeSafe, Google Fact Check, cloud embeddings). Default `cloud`.
- **Budget:** Jev usage counts against `CLOUD_DAILY_BUDGET_USD` like the Anthropic usage (price table: $0.042 per 1M input tokens, output free).

## Alternatives

- **LLM only:** simplest, but LLM-reported probabilities are not calibrated and every decision costs a generation.
- **Jev only:** fastest per decision, but not available to everyone, not local, weaker in German and at numbers.
- **Fine-tuned local classifier now:** no data yet; that is phase 7, gated by the eval.
- **Jev's `confidence` as-is, LLM without confidence:** would make the providers incomparable in the calibration metrics.

## Consequences

- The eval (brief 13.5) decides which provider is the default; until then `llm`.
- Numeric and temporal claims are a known Jev weakness; the claim eval set gets a dedicated slice for them.
- Without Jev access, `typesafe` is tested only against a local fake server; the DoD run is skipped and named in the PR.
- The confidence formula lives in one place and is covered by property-style unit tests.
