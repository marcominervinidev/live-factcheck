# AGENTS.md – services/claim-extractor

Rules for this service only. Repo-wide rules: `/AGENTS.md`. Structure copied from the reference service `services/gateway`.

- Responsibility (brief 5, 6, 8.1; ADR 0017): reads final segments from `transcript.segments`, keeps a window per session in Redis (`src/store.ts`), drops small talk in the deterministic pre-filter (`src/prefilter.ts`), asks the `DETECTOR` classifier (Bool "checkable claim" + Score "checkworthiness"), formulates positive cases as one standalone sentence (`prompts/standalone.md`, `EXTRACTOR_LLM_*`), deduplicates (exact normalised text, then similar wording confirmed by the classifier) and publishes `ClaimDetected` v3 to `claims.detected` and the session channel (`src/detect.ts`).
- Precision first: a "yes" below `DETECTOR_CONFIDENCE_HIGH` is dropped, never shown. Every drop is counted by reason (`segments_dropped_total`), no transcript text in logs.
- Window and claim memory expire `EXTRACTOR_MEMORY_TTL_MS` (15 min) after a session's last segment; every segment refreshes all three keys (ADR 0018).
- The classifier state contains the window as context; speakers are letters (A, B, …), never names (brief 15.6, owner decision 2026-09-29).
- Only the consumer whose `addClaim` registers the normalised text first (atomic `SADD`) publishes a claim, so parallel extractor replicas cannot publish the same exact claim twice. The "similar wording" check is not atomic across replicas; with one replica today that is accepted; with several, the worst case is the same claim shown twice in slightly different words.
- `normalizedText` comes from `normalizeClaimText` in `@lfc/service-kit`, the same function as the gateway's text mode, so spoken and typed claims share the verdict cache.
- `prompts/` must stay in `files` of `package.json`: the runtime image contains only what `pnpm deploy` packs.
- Mock mode (`DETECTOR_CLASSIFIER_PROVIDER=mock`, `EXTRACTOR_LLM_PROVIDER=mock`, `src/mocks.ts`): a segment with a number is a claim, the standalone wording is the segment itself.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD`, `EXTRACTOR_LLM_API_KEY` and `TYPESAFE_API_KEY` (via `<KEY>_FILE` in containers).
- LLM config (brief 8) comes from `@lfc/providers`: `EXTRACTOR_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY}`, independent of the fact-checker's `CHECKER_*`. `anthropic` needs the API key, `openai-compatible` needs the base URL, `mock` needs neither. Never hard-code model names; log only `describeLlmConfig()`, never the key.
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
