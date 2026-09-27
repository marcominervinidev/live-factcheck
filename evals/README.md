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

## Running an eval

The runner behaves like a client: it opens a session over the WebSocket, sends every claim through `POST /api/claims/check` and waits for `claims.checked`. It measures the stack as configured, so choose the providers first (see the root README, "Echte Modelle"), then:

```sh
make eval EVAL_LABEL=claude-opus-5          # only owner-reviewed labels count
make eval EVAL_LABEL=dry EVAL_INCLUDE_UNREVIEWED=true EVAL_LIMIT=5   # dry run, marked invalid
```

Output in `docs/evidence/phase-1/evals/`: `eval-<label>-<time>.md` (report), `.svg` (reliability diagram) and `.json` (raw verdicts). Claims run one after another, so latencies stay comparable and the rate limit is respected.

Metrics:

| Metric | Meaning |
|---|---|
| Accuracy | exact verdict matches |
| Direction accuracy | same direction: wahr (stimmt, größtenteils richtig), falsch (übertrieben, falsch), offen (nicht prüfbar) |
| Coverage | share of checkable claims that got a real verdict instead of `nicht_pruefbar` |
| Brier score | multi-class, 0 perfect, 2 worst |
| ECE + reliability diagram | calibration of the probability of the chosen verdict (10 bins) |
| Latency p50/p95 | pipeline `timings.totalMs` and client-side, per path (`cacheHit`, brief 9.6) |
| Cost | mean and total `usage.estimatedCostUsd` per claim |

Every paid run needs the owner's go-ahead with a cost estimate first.
