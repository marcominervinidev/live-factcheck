# AGENTS.md – services/explainer

Rules for this service only. Repo-wide rules: `/AGENTS.md`. Structure copied from the worker `services/claim-extractor`, which follows the reference service `services/gateway`.

- Responsibility (brief 5, 6a; ADR 0009): reads `claims.checked` (consumer group `explainer`), asks an LLM for at most two German sentences explaining the verdict, and publishes `ClaimExplained` to `claims.explained` and the session channel. It never delays or changes a verdict. `src/explain.ts` holds the logic, `src/main.ts` the wiring; a processed claim is marked even when no explanation could be produced (the verdict is already shown, no retry storm).
- Least privilege (brief 15.1): the only provider secret is `EXPLAINER_LLM_API_KEY` (via `EXPLAINER_LLM_API_KEY_FILE`). Never add classifier (TypeSafe) or search keys here.
- LLM config (brief 8) comes from `@lfc/providers`: `EXPLAINER_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY}`, plus `PRIVACY_MODE` (`local` refuses cloud providers). Never hard-code model names; log only `describeLlmConfig()`, never the key.
- Prompts live as versioned files under `prompts/` with placeholders (brief 8), not as strings in code. Evidence snippets are untrusted data: always delimit them as data, never as instructions.
- On failure (LLM error, invalid output after one repair attempt, budget exceeded) publish nothing; count it in a metric. The UI keeps its placeholder.
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
- Cloud LLM calls count against the shared daily budget (`CLOUD_DAILY_BUDGET_USD`, brief 15.5).
- `mockExplanation` in `src/explain.ts` is for `EXPLAINER_LLM_PROVIDER=mock` (tests and CI) only.
