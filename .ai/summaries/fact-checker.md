# Summary: `services/fact-checker` (state after phase 0)

**Responsibility (brief 5, 9.6):** consume `claims.detected`, check verdict cache → (phase 4: evidence store) → live research, let the classifier decide, publish `claims.checked` immediately; the explanation is the `explainer`'s job.

**Current state:** skeleton. `main.ts` logs `describeLlmConfig('CHECKER', …)` and connects to Redis; `config.ts` = base + Redis + `CHECKER_LLM_*` with `checkLlmConfig`. `secretKeys` = Redis password + `CHECKER_LLM_API_KEY`.

**Environment:** network `internal` only (no internet yet; phase 1 adds `egress`). Secrets `redis_password`, `anthropic_api_key` (mounted as `CHECKER_LLM_API_KEY_FILE`).

**Tests:** `main.test.ts` (fail fast), `main.int.test.ts` (a random API key never appears in any log line; secret via `_FILE`).

**Phase 1 adds:** classifier and embeddings config, `packages/research` for sources/chunking/ranking, exact verdict cache, stream consumer, metrics, `timings`.

**Pitfalls:**
- Fetches URLs chosen by strangers → SSRF guard is mandatory (`.ai/research/research-pipeline.md`).
- Snippets are untrusted data → prompt-injection delimiting; cited evidence ids must come from the fetched list.
- At-least-once delivery: `XACK` only after publishing; idempotent by `claimId`.
