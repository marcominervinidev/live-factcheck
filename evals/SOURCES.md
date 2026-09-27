# Eval data sources

Origin and licence of every source used in `evals/*.jsonl` (brief 13.5). Add a row before the first item from a new source is committed; every item references its source by `sourceId`.

| sourceId | Source | Used for | Licence / terms | Notes |
|---|---|---|---|---|
| – | – | – | – | No items yet. Planned: published fact checks with ClaimReview ratings via the Google Fact Check Tools API (verdict set, phase 1), Bundestag plenary protocols (detection set, phase 2), own test conversations with consent of everyone involved. |

Checklist for a new source:

1. Licence allows storing short excerpts in a public repository (quote only what the label needs).
2. No personal data beyond what the source itself publishes; own conversations only with consent.
3. Owner has reviewed every label taken from it.
