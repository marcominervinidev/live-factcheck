# AGENTS.md – packages/providers

Rules for this package only. Repo-wide rules: `/AGENTS.md`.

- Adapter pattern for every external dependency (brief 4, 8–10): LLM, classifier, embeddings, speech-to-text, web search. Providers are chosen by configuration only; services never import an SDK directly.
- Configuration helpers: LLM (`llmConfigShape`, `checkLlmConfig`, `describeLlmConfig`, `llmSecretKey`), classifier (`classifierConfigShape`, `checkClassifierConfig`, `describeClassifierConfig`; ADR 0007) and privacy (`privacyModeShape`, `checkPrivacyMode`, `llmUse`, `classifierUse`). Adapters: `createLlmProvider`, `createClassifier`, `createEmbeddingProvider`, `createSearchProvider`; plus `estimateCostUsd` and `createDailyBudget`.
- Every service that configures an external provider adds its uses to `checkPrivacyMode`, so `PRIVACY_MODE=local` refuses cloud providers at startup (brief 15.6). An unknown endpoint counts as cloud (fail closed).
- Classifier answers always carry `probabilities` and a `confidence` computed with the one shared formula (ADR 0007), whatever the provider.
- Model names are never hard-coded; they come from `<TASK>_LLM_MODEL`.
- Configuration is per task (LLM: `EXTRACTOR`, `CHECKER`, `EXPLAINER`; classifier: `CHECKER`, `DETECTOR` from phase 2), so each step can use a different provider.
- Never log or return an API key; `describeLlmConfig` is the only thing services log about a provider.
- Every adapter gets a `mock` counterpart that tests use at the system boundary.
- `mock` providers get their answers from the calling service (`mock` handler option), so deterministic test answers live next to the prompts that need them; mock answers are validated like real ones.
- Every failure is typed (`LlmError`, `ClassifierError`, `EmbeddingError`, `SearchError`, `BudgetExceededError`) and carries the tokens already spent; callers turn it into `nicht_pruefbar`, never a crash.
- Classifier state contains only what the question needs (claim, snippets). Never pass speaker names or transcript context to a classifier: Jev runs in the US (brief 15.6).
- Search results are URLs chosen by strangers: fetch them only through the SSRF-safe fetch in `packages/research`, never with plain `fetch`.
- The classifier prompt lives in `prompts/classifier.md` (shipped with the package via `files`).
- Adapter tests run against the local fake API server in `src/testing/fake-server.ts`; no real network.
