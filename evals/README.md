# Evals

Quality measurements of the LLM and classifier setups (brief 13.5). They run manually or weekly with dedicated, budget-limited API keys, never on every push; CI uses only `mock` providers.

| Set | File | Phase | Measures |
|---|---|---|---|
| Verdict | `claims.de.jsonl` (target ≥ 200 claims) | 1 | accuracy, calibration (Brier score, expected calibration error, reliability diagram), latency p50/p95 per path (`cacheHit`), cost per claim |
| Detection | `detection.de.jsonl` (234 segments: 161 from speeches, 73 from a Befragung; target several hundred) | 2 | precision, recall, F1 of "the segment becomes a new claim", latency p50/p95 |

The eval result decides which classifier becomes the default and whether phase 7 (own model) is needed.

## Rules

- Every label is reviewed by the owner before it enters a set. An LLM may propose labels; the proposal is never the label.
- Origin and licence of every source are listed in [SOURCES.md](SOURCES.md).
- Audio behind a set is real people speaking, never synthetic voices or scripts read aloud (owner, 2026-10-02): scenarios stay close to reality, with different voices, ages and genders. Copyrighted recordings such as TV talk shows are measured locally only; the repository keeps their numbers, never their audio or transcript.
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

### Detection set

`make eval EVAL_SET=detection EVAL_LABEL=<name>` replays every conversation of `detection.de.jsonl` as final transcript segments into `transcript.segments` (one session per conversation, segments in file order, so the classifier sees the same window as live) and waits until the claim-extractor has handled each segment. A segment counts as detected when a new claim with its id reaches `claims.detected`; duplicates dropped by the extractor count as not detected. Timeouts are reported separately and never count as correct.

**Label rule** (owner, 2026-09-30): `expected: true` means "this segment should appear in the app as a claim to check". All of these must hold:

1. **Checkable:** it states facts, figures, events or states that sources can confirm or refute. Opinions, judgements, forecasts, promises and appeals are not claims.
2. **Worth checking:** a listener could reasonably want it checked (checkworthiness ≥ 3 of 5). Asides such as the speaker's biography or remarks about the ongoing debate are `false`.
3. **Rhetorical questions count** when they insinuate a checkable fact ("Waren es nicht Sie, der … vorgeworfen hat?"). Genuine questions do not.
4. **Context decides:** a segment that is only checkable with the previous ones is judged with them; if it then repeats an earlier claim of the same conversation, it is `false` (deduplication).

Labels proposed or corrected by an LLM keep `reviewed: false`; only the owner sets `true`.

Live mode takes only audio through the gateway, so this runner (`eval-detection` in `compose.test.yaml`) runs in the internal network with the services' Redis user instead of acting as a client. Reports: `docs/evidence/phase-2/evals/eval-detection-<label>-<time>.md` and `.json`. The report shows the whole set and one row per `sourceId`, so a gain on one kind of speech cannot hide a loss on another. A set under `evals/local/` (copyrighted recordings, kept out of git) writes its report and raw rows to `evals/local/reports/` instead, because ids and source names can tell what was measured; only aggregate numbers go into the evidence by hand. Neither output ever contains segment text. With the mock classifier (every segment with a digit is a claim) a dry run checks only the mechanics.

### Extracting from structured sources

When building a set from a structured source (a plenary protocol, an export with element
classes), list **every** element class of the source first and decide for each one explicitly
whether it is included. Skipping a class silently loses exactly the content it carries - the
protocol's quotation paragraphs (class `Z`) were dropped once and several segments lost the
words they attribute (lesson 2026-09-30).

### In GitHub Actions

`nightly.yml` → "Run workflow" with `eval: true` runs only the eval (never on the schedule):

- `eval-setup: mock` checks the mechanics with the mock providers; free, report marked invalid.
- `eval-setup: claude` uses Claude (checker `claude-opus-5`, explainer `claude-haiku-4-5`) with live research. It needs the GitHub environment `eval` with required reviewers, the secret `ANTHROPIC_EVAL_API_KEY` (a dedicated, budget-limited key) and optionally the variable `EVAL_BUDGET_USD` (default 5, the stack's daily budget cap).

The report, diagram and raw verdicts are uploaded as the artifact `eval-<label>`.
