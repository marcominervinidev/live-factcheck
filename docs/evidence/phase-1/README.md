# Phase 1 evidence

Every claim of phase 1 maps to an artifact here, a test in the repo or a CI run (brief 1.3). Local runs used throwaway secrets in an isolated Compose project (`lfc-verify`), never the owner's stack or secrets. Plan: [`.ai/plans/phase-1-faktencheck-textmodus.md`](../../../.ai/plans/phase-1-faktencheck-textmodus.md).

## Definition of Done (brief 17, phase 1)

| # | DoD item | Evidence | State |
|---|---|---|---|
| 1 | A typed claim is checked with Claude | adapter tests against a fake server (`packages/providers/src/llm/anthropic.test.ts`); paid eval run | **open**: waits for the owner's label review and go-ahead (cost estimate in [tp7-eval.txt](tp7-eval.txt)) |
| 2 | … with LM Studio or Ollama | `openai-compatible` adapter tests; eval run against a local model | **open**: owner runs LM Studio/Ollama |
| 3 | … with Jev as classifier (if access) | `typesafe` adapter only against a local fake server ([tp2-providers.txt](tp2-providers.txt)); no access yet | named in the PR (ADR 0007) |
| 4 | The verdict appears before the explanation | stage 3 test `tests/api/text-mode.spec.ts` (WebSocket order), stage 4 `tests/e2e/text-mode.spec.ts`; [tp5-gateway.txt](tp5-gateway.txt), [tp6-frontend.txt](tp6-frontend.txt), [screens/03-verdict-and-explanation.png](screens/03-verdict-and-explanation.png) | done |
| 5 | An eval report compares accuracy, calibration, latency and cost | runner and metrics ([tp7-eval.txt](tp7-eval.txt)), mock dry run in [evals/](evals/) | mechanics done; real comparison **open** (items 1–2) |
| 6 | SSRF and prompt-injection protection | unit tests of the attack cases ([tp3-research.txt](tp3-research.txt)), explainer link check, security reviews ([tp8-review.txt](tp8-review.txt)) | done |
| 7 | No key in the browser, logs or events | log-redaction tests, `/api/status` without keys, security review ([tp8-review.txt](tp8-review.txt)) | done |

## By task package

| TP | Content | Evidence |
|---|---|---|
| 0 | gap analysis, ADRs 0007–0009, scaffolds | [tp0-gap-catch-up.txt](tp0-gap-catch-up.txt) |
| 1 | contracts v2 (events), v1 (HTTP API, WebSocket) | [tp1-contracts.txt](tp1-contracts.txt) |
| 2 | provider adapters (LLM, classifier, embeddings, search, budget, privacy mode) | [tp2-providers.txt](tp2-providers.txt) |
| 3 | research (SSRF-safe fetch, robots, source tiers, ranking) | [tp3-research.txt](tp3-research.txt) |
| 4 | streams, fact-checker pipeline, explainer | [tp4-pipeline.txt](tp4-pipeline.txt) |
| 5 | gateway (token auth, text-mode API, session WebSocket), stage 3 | [tp5-gateway.txt](tp5-gateway.txt) |
| 6 | frontend (text mode, cards, timeline, settings), stages 1, 2b, 4 | [tp6-frontend.txt](tp6-frontend.txt), [screens/](screens/) |
| 7 | eval, coverage gate, mutation testing, Renovate | [tp7-eval.txt](tp7-eval.txt), [evals/](evals/) |
| 8 | reviews and their fixes, docs | [tp8-review.txt](tp8-review.txt) |
