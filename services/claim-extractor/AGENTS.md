# AGENTS.md – services/claim-extractor

Rules for this service only. Repo-wide rules: `/AGENTS.md`. Structure copied from the reference service `services/gateway`.

- Responsibility (brief 5, 6): reads final segments from `transcript.segments`, keeps a rolling window per session, extracts checkable factual claims via an LLM, deduplicates them and publishes to `claims.detected` (from phase 2 on). In phase 0 it only has the ops endpoints, a Redis connection and a validated LLM configuration.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD` (via `REDIS_PASSWORD_FILE` in containers) and `EXTRACTOR_LLM_API_KEY` (via `EXTRACTOR_LLM_API_KEY_FILE`).
- LLM config (brief 8) comes from `@lfc/providers`: `EXTRACTOR_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY}`, independent of the fact-checker's `CHECKER_*`. `anthropic` needs the API key, `openai-compatible` needs the base URL, `mock` needs neither. Never hard-code model names; log only `describeLlmConfig()`, never the key.
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
