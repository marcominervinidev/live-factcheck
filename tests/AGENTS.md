# AGENTS.md – tests/ (stages 3 and 4)

Rules for the system and E2E suites. Repo-wide rules: `/AGENTS.md`; stage definitions: brief 13.2.

- `tests/api` (stage 3) talks to services over HTTP only, never imports their code (dependency-cruiser enforces this). `tests/e2e` (stage 4) sees only what a browser sees: the edge through Caddy.
- Both run as Playwright containers inside the stack networks via `compose.test.yaml` (`make test-api`, `make test-e2e`). Caddy is reachable as `lfc.local:8443`, so TLS works via SNI.
- Mock providers only; no real API keys, no external network except what the stack itself uses. The one exception is `tests/redteam` (below), which needs a real model behind the pipeline.
- E2E stays small: only critical user journeys. Everything a lower stage can prove belongs there (2b for UI behaviour with a mocked backend, 3 for API behaviour).
- Pick the lowest stage that can show the behaviour (brief 13.1). Error cases and edge cases go to stage 1 or 2a (e.g. every audio error code is a gateway integration test); stage 3 proves the path through the real stack plus a few spot checks, stage 4 only the user journeys of brief 13.2. Before adding a test, check that no lower stage already covers it – no duplicates across stages.
- Reuse before writing new: read the existing helpers (`tests/api/session.ts`), page objects (`tests/e2e/pages/`) and fixtures first. Extend or parameterise them instead of creating near-copies; a new page object only for a page or component that has none.
- Tests that prove a DoD or acceptance criterion of a phase carry the tag `@dod` in their title and are listed in the phase plan's table "DoD → Tests", so every criterion has exactly one proving test at the right stage.
- A failing test is fixed in the code, the helper or the page object – never by weakening its assertion (`/AGENTS.md`, no shortcuts).
- Page objects in `tests/e2e/pages/`, selectors by `data-testid` or accessible role only.
- Each test is independent: own `sessionId`, no ordering assumptions. Retries only in CI and at most once; a flaky test gets an issue and `@quarantine`, not a wait.
- To run them yourself, use an isolated Compose project (see `/AGENTS.md`), never the owner's running stack.
- `tests/redteam` (brief 15.7, ADR 0014): promptfoo against the real pipeline with a real model, run by hand (`make redteam`) at the end of every phase and whenever prompts, models, classifier, research sources or the explainer change – not on every PR. Checks stay deterministic code in `src/assertions.ts`; promptfoo's telemetry, sharing and hosted generation stay off.
