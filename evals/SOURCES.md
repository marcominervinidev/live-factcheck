# Eval data sources

Origin and licence of every source used in `evals/*.jsonl` (brief 13.5). Add a row before the first item from a new source is committed; every item references its source by `sourceId`.

| sourceId | Source | Used for | Licence / terms | Notes |
|---|---|---|---|---|
| `agent-seed` | Claims written by the coding agent from well-established, easily checked facts (dates, numbers, people, places, science) plus opinions and predictions | verdict set `claims.de.jsonl` (46 items) | own work | Each item has a `note` with the reason for its label. **All labels are `reviewed: false` until the owner has checked them**; `pnpm eval` ignores unreviewed items unless `EVAL_INCLUDE_UNREVIEWED=true` (dry runs only). |
| `bundestag-pp` | Plenarprotokoll 20/213 des Deutschen Bundestags (13. März 2025), XML aus dem Open-Data-Angebot `https://www.bundestag.de/services/opendata` | detection set `detection.de.jsonl` (161 segments from six speeches) | official work, no copyright (§ 5 UrhG); the Bundestag's terms ([impressum](https://www.bundestag.de/impressum)) still ask for unchanged text (§ 62 UrhG) and the source (§ 63 UrhG), with no guarantee against third-party rights | Speeches split into sentences like STT output, quotations (paragraph class `Z`) kept in place and never split; speakers replaced by `A`, interjections left out. Names of public officials inside the speeches stay as published. Labels proposed by the coding agent, reviewed by two further LLMs, merged under the owner's label rule (README) and accepted by the owner as a whole on 2026-09-30, not line by line; lines the owner decided himself say so in `note`. |
| `bundestag-befragung` | Plenarprotokoll 21/95 des Deutschen Bundestags (23. September 2026), Tagesordnungspunkt 1 „Befragung der Bundesregierung“, XML aus dem Open-Data-Angebot `https://www.bundestag.de/services/opendata` | detection set `detection.de.jsonl` (73 segments, one conversation: questions, follow-ups, answers and interjections on the Bundeswehr brigade in Lithuania) | official work, no copyright (§ 5 UrhG); the Bundestag's terms ([impressum](https://www.bundestag.de/impressum)) still ask for unchanged text (§ 62 UrhG) and the source (§ 63 UrhG), with no guarantee against third-party rights | Turns 3–10 of the Befragung, element classes decided one by one: speaker lines (`redner`, `name`) become letters in order of appearance; spoken paragraphs (`J_1`, `J`) are split into sentences like STT output; a sentence cut by an interjection stays cut (`O` continues it as its own segment); interjections with words (`kommentar` "Name [Party]: …") are segments of their own speaker, wordless ones (applause, laughter) are left out; quotations (`Z`) are kept whole; agenda titles are left out. Names of public officials inside the text stay as published. Segments are verbatim, no-break spaces included; a label fix never rewrites the text. **Limitation:** edited protocol text has far fewer and cleaner fragments than live STT output (one claim spread over fragments, `-47`/`-49`), so it does not measure the fragment problem of the live test of 2026-10-01; that part of E2 needs real recordings run through the STT. Labels proposed by the coding agent, **`reviewed: false` until the owner has checked them** (plan task E2). |

Planned next (still no items):

- Published fact checks with ClaimReview ratings via the Google Fact Check Tools API (verdict set, to reach ≥ 200 claims). The rating text of the publisher is mapped to our five verdicts in a reviewed step; only the claim wording and the rating are stored, never article text.
- More plenary protocols and freely licensed recordings of real conversations for the detection set (plan task E2, sources in `.ai/research/conversation-audio-sources.md`; target several hundred segments). TV talk shows never get a row (checklist item 4).
- Own test conversations, only with the consent of everyone involved.

Checklist for a new source:

1. Licence allows storing short excerpts in a public repository (quote only what the label needs).
2. No personal data beyond what the source itself publishes; own conversations only with consent.
3. Owner has reviewed every label taken from it.
4. Not a copyrighted recording that may only be used privately, such as a TV talk show (owner, 2026-10-02): those are measured locally from `evals/local/`, and only aggregate numbers are committed (README).

## Reviewing labels

Open `claims.de.jsonl`, check `claim`, `expected` and `note` of each line, correct what is wrong and set `"reviewed": true`. A changed label is its own commit with a short reason (see README).
