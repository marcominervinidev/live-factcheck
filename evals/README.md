# Evals

Quality measurements of the LLM and classifier setups (brief 13.5). They run manually or weekly with dedicated, budget-limited API keys, never on every push; CI uses only `mock` providers.

| Set | File | Phase | Measures |
|---|---|---|---|
| Verdict | `claims.de.jsonl` (target ≥ 200 claims) | 1 | accuracy, calibration (Brier score, expected calibration error, reliability diagram), latency p50/p95 per path (`cacheHit`), cost per claim |
| Detection | `detection.de.jsonl` (target several hundred segments) | 2 | precision, recall, F1 of "contains a check-worthy claim", plus the expected standalone wording |

The eval result decides which classifier becomes the default and whether phase 7 (own model) is needed.

## Rules

- Every label is reviewed by the owner before it enters a set. An LLM may propose labels; the proposal is never the label.
- Origin and licence of every source are listed in [SOURCES.md](SOURCES.md).
- The sets are versioned; a changed label is a new commit with a reason, never a silent edit.
- Reports go to `docs/evidence/phase-N/eval-<setup>-<date>.md`.

The runner (`pnpm eval`, `make eval`) arrives with plan task T7.2.
