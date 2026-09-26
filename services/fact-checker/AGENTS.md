# AGENTS.md – services/fact-checker

Rules for this service only. Repo-wide rules: `/AGENTS.md`. Structure copied from the reference service `services/gateway`.

- Responsibility (brief 5, 9.6): consumes `claims.detected` (group `fact-checker`), checks the exact verdict cache, researches the three source tiers via `@lfc/research`, ranks chunks, lets the classifier decide relevance, sufficiency, verdict and best snippet, applies the thresholds and publishes `claims.checked` to the stream and the session channel. The explanation is the `explainer`'s job. `src/pipeline.ts` holds the flow, `src/wiring.ts` builds it from config, `src/main.ts` stays thin.
- Every failure ends as `nicht_pruefbar` with a `reason`; only infrastructure errors (Redis) throw, so the message stays pending and is retried.
- The classifier only picks among our own snippet keys (`S1…`, `F1…`), so it cannot cite a foreign source (brief 15.5). Snippets and claims are data in the classifier state, never instructions.
- Only verdicts other than `nicht_pruefbar` are cached; the cache key keeps numbers and negations (ADR 0008).
- Never log claim text or snippets (brief 15.6); log ids, verdict, level, cache level, reason and timings.
- `CHECKER_RESEARCH_SOURCES=mock` and the mock handlers in `src/mocks.ts` exist for tests and CI only (no network, no keys).
- Prompts: `prompts/queries.md` (search queries) and `prompts/questions.yaml` (classifier questions, English for Jev). Changing them changes eval results.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD`, `CHECKER_LLM_API_KEY`, `TYPESAFE_API_KEY`, `EMBEDDINGS_API_KEY`, `GOOGLE_FACTCHECK_API_KEY` (all via `<KEY>_FILE` in containers).
- LLM config (brief 8) comes from `@lfc/providers`: `CHECKER_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY}`, independent of the claim-extractor's `EXTRACTOR_*`. `anthropic` needs the API key, `openai-compatible` needs the base URL, `mock` needs neither. Never hard-code model names; log only `describeLlmConfig()`, never the key.
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
