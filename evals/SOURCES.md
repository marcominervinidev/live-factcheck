# Eval data sources

Origin and licence of every source used in `evals/*.jsonl` (brief 13.5). Add a row before the first item from a new source is committed; every item references its source by `sourceId`.

| sourceId | Source | Used for | Licence / terms | Notes |
|---|---|---|---|---|
| `agent-seed` | Claims written by the coding agent from well-established, easily checked facts (dates, numbers, people, places, science) plus opinions and predictions | verdict set `claims.de.jsonl` (46 items) | own work | Each item has a `note` with the reason for its label. **All labels are `reviewed: false` until the owner has checked them**; `pnpm eval` ignores unreviewed items unless `EVAL_INCLUDE_UNREVIEWED=true` (dry runs only). |
| `bundestag-pp` | Plenarprotokoll 20/213 des Deutschen Bundestags (13. März 2025), XML aus dem Open-Data-Angebot `https://www.bundestag.de/services/opendata` | detection set `detection.de.jsonl` (154 segments from six speeches) | official work, no copyright (§ 5 UrhG) | Speeches split into sentences like STT output; speakers replaced by `A`, interjections left out. Names of public officials inside the speeches stay as published. Labels proposed by the coding agent with a `note` each; **`reviewed: false` until the owner has checked them**. |

Planned next (still no items):

- Published fact checks with ClaimReview ratings via the Google Fact Check Tools API (verdict set, to reach ≥ 200 claims). The rating text of the publisher is mapped to our five verdicts in a reviewed step; only the claim wording and the rating are stored, never article text.
- More plenary protocols and talk-show transcripts for the detection set (target several hundred segments).
- Own test conversations, only with the consent of everyone involved.

Checklist for a new source:

1. Licence allows storing short excerpts in a public repository (quote only what the label needs).
2. No personal data beyond what the source itself publishes; own conversations only with consent.
3. Owner has reviewed every label taken from it.

## Reviewing labels

Open `claims.de.jsonl`, check `claim`, `expected` and `note` of each line, correct what is wrong and set `"reviewed": true`. A changed label is its own commit with a short reason (see README).
