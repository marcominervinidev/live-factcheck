# Summary: `packages/providers` (state after phase 0)

**Responsibility:** adapters for external dependencies (brief 8, 8.1, 9, 10): LLM, classifier, embeddings, search, later STT. After phase 0 it only holds the **LLM configuration**, no adapter.

**Existing code:** `src/llm/config.ts`
- `LLM_PROVIDERS = ['anthropic', 'openai-compatible', 'mock']`, `LlmTask = 'EXTRACTOR' | 'CHECKER'`.
- `llmConfigShape(task)` → zod fields `<TASK>_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY}` (model required, never hard-coded).
- `checkLlmConfig(task)` for `superRefine`: `anthropic` needs a key, `openai-compatible` needs a base URL.
- `llmSecretKey(task)` for the service's `secretKeys`; `describeLlmConfig` = what may be logged (provider, model, base URL origin).

**Used by:** `claim-extractor` (`EXTRACTOR`), `fact-checker` (`CHECKER`); both log `describeLlmConfig` at start.

**Phase 1 adds:** task `EXPLAINER`; `classifier/` (config, `llm`, `mock`, `typesafe`), `llm/` adapters, `embeddings/`, `search/searxng`, pricing and budget, `privacy.ts` (`PRIVACY_MODE`).

**Pitfalls:**
- Generic mapped types over template-literal keys need the documented casts in `config.ts`; keep them local.
- Tests of adapters use a local fake HTTP server (system boundary), never mocks of our own modules.
- Package `exports` only expose `src/index.ts`; add new public API there.
