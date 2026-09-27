# AGENTS.md – packages/research

Rules for this package only. Repo-wide rules: `/AGENTS.md`. Background: `.ai/research/research-pipeline.md`, `.ai/research/evidence-sources.md`.

- Responsibility (brief 9): everything between "a claim" and "ranked evidence": the source tiers (Google Fact Check API, Wikipedia/Wikidata, web search via `SearchProvider`), safe page fetching, main-text extraction, chunking, ranking and the search/page caches. Used by `fact-checker` now and `topic-tracker` in phase 4. It never decides a verdict; that is the classifier's job.
- Every outbound request goes through the safe fetch (SSRF guard, brief 15.5), including fixed API hosts. No second HTTP path.
- Fetched text is untrusted data. Only short snippets (sentence-aligned, ≤ 300 characters) ever leave this package towards events or the UI; never whole pages (brief 9.2).
- Source tiers and weights are data in `config/source-tiers.yaml`, validated by `parseSourceTiers` at service start. Never hard-code domains in code.
- Retrieval stays behind `rankChunks` so phase 4 can replace the in-memory ranking with the evidence store (ADR 0013) without touching callers.
- Tests use a local fake HTTP server at the system boundary; no real network, no mocks of this package's own modules. SSRF attack cases are written before the guard.
- `createSafeFetcher` is the only HTTP client here. Its `policy` and `resolve` options exist for tests (fake server on 127.0.0.1); production code never passes them, so `PUBLIC_WEB` and the system DNS apply.
- Every source degrades gracefully: a failing or slow tier is dropped (`researchClaim` reports it in `failures`), never the whole research.
- robots.txt uses the in-house RFC 9309 matcher (`robots-rules.ts`); 4xx allows, 5xx or unreachable disallows.
- API keys (Google Fact Check) go in headers, never in URLs; cache keys never contain secrets.
