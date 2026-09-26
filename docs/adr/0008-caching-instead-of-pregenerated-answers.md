# 0008: Caching instead of pre-generated questions and answers

- Status: proposed
- Date: 2026-09-26

## Context

Live checks must be fast (targets from brief 9.6: cache hit < 1 s, evidence store 1–3 s, live research 5–10 s). One idea is to pre-generate likely claims and their verdicts per topic. Brief 9.5 rejects that: the space of claims is open, almost all pre-generated pairs would never be used, and a pre-generated answer was never checked against the actual wording.

## Decision

Three cache levels, introduced step by step:

1. **Verdict cache**
   - *Exact* (phase 1): key `verdict:v1:<sha256(normalizedText)>` in Redis, value = the verdict part of `ClaimChecked` (verdict, probabilities, confidence, evidence, provider). TTL `CHECKER_VERDICT_CACHE_TTL_S` (default 7 days). A hit publishes a new `ClaimChecked` for the new `claimId` with `cacheHit: "verdict_exact"` and fresh `timings`. Normalisation: Unicode NFKC, lower case, collapsed whitespace, stripped trailing punctuation; **numbers and negations are kept**, so "1945" and "1955" never share a key.
   - *Semantic* (phase 4): embedding similarity, used only if the classifier confirms "both claims have the same truth value" (brief 9.5). Not built in phase 1.
2. **Evidence store** (phase 4, ADR 0013): chunks from earlier checks and topic prefetch.
3. **Search and page cache** (phase 1): Redis keys `search:v1:<provider>:<sha256(query)>` and `page:v1:<sha256(url)>` with short TTLs (`RESEARCH_SEARCH_CACHE_TTL_S` default 1 h, `RESEARCH_PAGE_CACHE_TTL_S` default 24 h), storing extracted text only, capped in size.

Cache keys are versioned (`v1`) so a change in normalisation or prompt invalidates old entries by key, not by flush.

## Alternatives

- **Pre-generated Q&A per topic:** rejected by the brief (see context).
- **No verdict cache:** every repeated claim costs a full research run; repeated claims are common in debates.
- **Semantic cache already in phase 1:** needs an embedding index and the "same truth value" check to be safe; the brief puts it in phase 4 with the evidence store.

## Consequences

- Time-critical facts (office holders, prices) can go stale within the TTL; phase 4 adds per-fact validity from the classifier (brief 9.3). Until then the TTL is the only guard and is short enough to be acceptable for a demo system.
- A wrong cached verdict repeats until it expires; `DEL verdict:v1:*` is the documented reset (runbook note in README).
- The eval reports latency per path (`cacheHit`), so the effect is measurable.
