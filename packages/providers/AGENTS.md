# AGENTS.md – packages/providers

Rules for this package only. Repo-wide rules: `/AGENTS.md`.

- Adapter pattern for every external dependency (brief 4, 8–10): LLM, speech-to-text, web search. Providers are chosen by configuration only; services never import an SDK directly.
- Phase 0 contains only the LLM configuration (`llmConfigShape`, `checkLlmConfig`, `describeLlmConfig`, `llmSecretKey`). Adapters (`anthropic`, `openai-compatible`, `mock`) arrive in phase 1.
- Model names are never hard-coded; they come from `<TASK>_LLM_MODEL`.
- Configuration is per task (`EXTRACTOR`, `CHECKER`), so extraction and verdict can use different providers.
- Never log or return an API key; `describeLlmConfig` is the only thing services log about a provider.
- Every adapter gets a `mock` counterpart that tests use at the system boundary.
