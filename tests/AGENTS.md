# AGENTS.md – tests/ (stages 3 and 4)

Rules for the system and E2E suites. Repo-wide rules: `/AGENTS.md`; stage definitions: brief 13.2.

- `tests/api` (stage 3) talks to services over HTTP only, never imports their code (dependency-cruiser enforces this). `tests/e2e` (stage 4) sees only what a browser sees: the edge through Caddy.
- Both run as Playwright containers inside the stack networks via `compose.test.yaml` (`make test-api`, `make test-e2e`). Caddy is reachable as `lfc.local:8443`, so TLS works via SNI.
- Mock providers only; no real API keys, no external network except what the stack itself uses. The one exception is `tests/redteam` (below), which needs a real model behind the pipeline.
- E2E stays small: only critical user journeys. Everything a lower stage can prove belongs there (2b for UI behaviour with a mocked backend, 3 for API behaviour).
- Page objects in `tests/e2e/pages/`, selectors by `data-testid` or accessible role only.
- Each test is independent: own `sessionId`, no ordering assumptions. Retries only in CI and at most once; a flaky test gets an issue and `@quarantine`, not a wait.
- To run them yourself, use an isolated Compose project (see `/AGENTS.md`), never the owner's running stack.
- `tests/redteam` (brief 15.7, ADR 0014): promptfoo against the real pipeline with a real model, run by hand (`make redteam`) at the end of every phase and whenever prompts, models, classifier, research sources or the explainer change – not on every PR. Checks stay deterministic code in `src/assertions.ts`; promptfoo's telemetry, sharing and hosted generation stay off.
