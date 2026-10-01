# Claim detection: zero-shot NLI models and external data (research, 2026-10-01)

Trigger: the owner received a suggestion to detect claims with a local zero-shot model
(`pipeline("zero-shot-classification", model="MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli")`,
labels `Behauptung` / `Frage` / `Gruß`) and to collect training data from Hugging Face, Kaggle
and the Leipzig Corpora Collection. This note records the measurement and the assessment.

## Measurement

Throwaway run outside the stack (CPU, 4 threads, transformers 4.57.6, torch 2.14.1), on the 161
owner-reviewed segments of `evals/detection.de.jsonl` (47 positive). Every segment is judged on
its own: no transcript window, no deduplication, so the numbers compare in kind with
`docs/evidence/phase-2/evals/`, not one to one. "Best F1" tunes the threshold on the scored set
itself and is therefore optimistic.

| Setup | AUC | Top label: P / R / F1 | Best F1 behind the pre-filter (P / R) | p50 per segment |
|---|---|---|---|---|
| A: English DeBERTa (as suggested), Behauptung/Frage/Gruß | 0.66 | 0.33 / 0.94 / 0.49 | 0.56 (0.40 / 0.91) | 633 ms |
| B: multilingual mDeBERTa-v3-base-mnli-xnli, same labels | 0.53 | 0.27 / 0.47 / 0.34 | 0.49 (0.35 / 0.87) | 602 ms |
| C: mDeBERTa, five task labels (Tatsachenbehauptung, Meinung, Frage, …) | 0.50 | 0 / 0 / 0 | 0.11 | 1008 ms |
| D: mDeBERTa, one yes/no hypothesis | 0.50 | 0.25 / 0.28 / 0.26 | 0.48 (0.39 / 0.60) | 222 ms |
| E: bge-m3-zeroshot-v2.0, five task labels | 0.48 | 0.18 / 0.04 / 0.07 | 0.49 (0.33 / 0.96) | 1521 ms |
| F: bge-m3-zeroshot-v2.0, one yes/no hypothesis | 0.63 | 0.56 / 0.38 / 0.46 | 0.52 (0.58 / 0.47) | 348 ms |

Baselines on the same set: everything is a claim F1 0.45; everything the pre-filter passes 0.50;
"the segment contains a digit" (the mock detector) 0.61; Jev 1.13 at 0.6 with the attribution
question, measured through the stack, **0.78** (`eval-detection-jev-0-60-attribution-*`).

Sanity check: fast and slow tokenizers give identical results, and the model-card examples come
out right (`politics` 0.97 and 1.00), so the models work as published. They answer a different
question: "Ich finde, das ist eine Frechheit." scores `Behauptung` 0.92 / 0.89. An opinion is an
assertion as a speech act; what we need is checkable fact versus opinion, and NLI zero-shot does
not separate the two in German political speech. Questions and greetings, the other two suggested
labels, are already dropped by the deterministic pre-filter (5 questions, 1 greeting in the set).

Assessment: no zero-shot NLI setup comes near the current detector or even the digit heuristic.
Not pursued as a classifier provider.

Side finding on the pre-filter: the only owner-labelled claim it drops is `bt20-213-r05-06`
("Was uns ebenfalls empört, liebe Kollegin Mast: Sie verlängern …"). It counts as a question
because it starts with an interrogative, although it has no question mark; it is one of Jev's ten
false negatives in the 0.78 run.

## Data sources

| Source | What is labelled | Useful for us |
|---|---|---|
| XNLI (Hugging Face) | premise–hypothesis pairs as entailment / neutral / contradiction, 15 languages incl. German | no: NLI training data, nothing marks a sentence as a checkable claim |
| Kaggle German news / sentiment sets | topic classes or sentiment polarity | no checkability label |
| Leipzig Corpora Collection | none (sentence lists from news and the web) | raw text only; every label would be ours (owner review rule, `evals/README.md`) |
| GermEval 2021, subtask fact-claiming | 4,188 Facebook comments from the page of a German public-TV political talk show (2019), binary "fact-claiming" | closest German label to ours and the talk-show domain; written comments, not speech; licence still to check before any download ([overview](https://aclanthology.org/2021.germeval-1.1), [task site](https://germeval2021toxic.github.io/SharedTask/)) |
| CLEF CheckThat! 2023/2024, subjectivity task | news sentences, subjective vs objective; German among the languages | covers the fact-vs-opinion boundary that failed above ([2023 overview](https://ceur-ws.org/Vol-3497/paper-020.pdf)) |

Training a model of our own is phase 7 of the brief, gated by the evals (F1 target 0.85; Jev is at
0.78). External sets would first serve as extra benchmarks, labelled as such and kept apart from
the owner-reviewed sets.

## Live test the same day

Talk-show recording through Deepgram and Jev at 0.6 (2026-10-01, 131 s, 25 final segments): no
claim. The extractor's drop counters for that recording: 8 `too_short` (fewer than 5 words),
8 `uncertain` (Jev said "claim" with a probability between 0.5 and 0.8), 8 `not_a_claim`,
1 `low_checkworthiness`. Two thirds of the losses sit before or at the edge of the classifier,
in fragments and borderline calls, and the detection set holds only Bundestag speeches.
