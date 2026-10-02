# 0017: Claim detection in the live transcript

- Status: accepted (Marco, Gate 0, 2026-09-29)
- Date: 2026-09-29

## Context

Brief 5, 6.5 and 8.1 describe the `claim-extractor`: a rolling window of recent segments per session, a deterministic pre-filter against small talk, a classifier deciding whether a segment contains a checkworthy factual claim, an LLM that rewrites positive cases into a standalone statement (pronouns and references resolved), and deduplication per session. Precision matters most live, because false alarms flood the feed (13.5). Workers must stay stateless (factor VI) and idempotent (at-least-once streams, `.ai/summaries/pipeline-streams.md`).

## Decision

**Input:** consumer group `claim-extractor` on `transcript.segments` (final segments only).

**Window:** per session the last `DETECTOR_WINDOW_SEGMENTS` (default 6) final segments, stored in Redis (`extractor:v1:window:{sessionId}`, list trimmed on write, TTL = session TTL). Sorted by `startMs` when read. The window gives context for resolving references; the decision is made for the newest segment.

**Pre-filter (deterministic, unit-tested):** drop a segment when it is shorter than `DETECTOR_MIN_WORDS` (default 5), consists of greetings or filler, or is pure opinion ("ich finde", "meiner Meinung nach" without a number, date, named entity or comparison). Questions are never dropped here (amendments below). The rules are data in `services/claim-extractor/src/prefilter.ts` with German test cases; every drop is counted by reason (metric).

**Classifier (`ClassifierProvider`, ADR 0007):** one call with two questions on the state "window + newest segment" – for every classifier provider, Jev (`typesafe`, USA) included; speaker names are always replaced by the letters `A`, `B`, … before the state leaves the service (owner decision 2026-09-29, brief 15.6): Bool "the newest segment contains a checkable factual claim" and Score "checkworthiness 1–5". Configuration `DETECTOR_CLASSIFIER_PROVIDER` (`llm` default, `typesafe`, `mock`), the `llm` classifier uses `EXTRACTOR_LLM_*`. Thresholds `DETECTOR_CONFIDENCE_HIGH` / `DETECTOR_CONFIDENCE_LOW` (start 0.75 / 0.5, tuned with the detection eval): below low → dropped; between → dropped too (precision first), counted as "uncertain" for the eval; high and score ≥ `DETECTOR_MIN_SCORE` (default 3) → positive. `checkworthiness` in the event = score mapped to 0..1.

**Standalone formulation (`EXTRACTOR_LLM_*`):** only for positive cases. Prompt `services/claim-extractor/prompts/standalone.md` (versioned, placeholders, segments passed as delimited data like in the fact-checker); output schema `{ standaloneText, originalText }`; the text must be one German sentence, at most 300 characters; invalid after one repair attempt → the claim is dropped and counted (no guess).

**Deduplication per session:** (1) the normalised `standaloneText` (`normalizeClaimText`, the same normalisation as the verdict cache key: numbers and negations kept, no stop-word removal, so "ist" and "ist nicht" never collapse) against a Redis set `extractor:v1:claims:{sessionId}`; (2) if no exact hit, compare with the last `DETECTOR_DEDUP_CANDIDATES` (default 10) claims of the session by token overlap (Jaccard ≥ 0.6) and confirm with the classifier's Bool "both statements have the same truth value" (protects against different numbers or negation, brief 8.1). Duplicates are dropped and counted.

**Output:** `ClaimDetected` (existing contract) to `claims.detected` with `toSession`, `sourceSegmentIds` = the segments the claim was built from, `provider: { classifier, model }`, `detectedAt`. The detection time (end of the newest source segment until publishing) is measured in the extractor. Today the fact-checker writes `timings.detectMs: 0`, because `ClaimDetected` does not carry it; plan task T1.4 adds a `detectMs` field to `ClaimDetected` (v3, text mode sends 0) so the fact-checker can copy it into `ClaimChecked.timings.detectMs` and the latency per path (brief 9.6) includes detection.

**Idempotency:** `processedMarker` per `segmentId`; the window write is idempotent (segment id as list member check).

**Eval:** `evals/detection.de.jsonl` (~150 segments from Bundestag protocols to start, each label checked by the owner), `pnpm eval --set detection` reports precision, recall, F1, uncertain rate and latency per provider setup.

## Alternatives

- **One LLM call for detection and formulation:** fewer calls, but no calibrated probability for the thresholds and a text generation for every segment, including negatives (cost, latency). Rejected; the brief separates classification and generation.
- **Embeddings for deduplication:** more robust to paraphrases, but needs the embedding provider in the extractor and a similarity threshold that cannot distinguish "15 %" from "50 %". The classifier confirmation handles that; embeddings may join in phase 4 with the semantic cache.
- **Window in process memory:** simpler, but breaks with several replicas and restarts (factor VI). Rejected.

## Consequences

- The extractor makes one classifier call per segment that passes the pre-filter, plus one LLM call per positive and occasionally one dedup confirmation; the pre-filter keeps most small talk away from the model.
- Precision-first thresholds will miss some claims; the eval makes this visible and the thresholds are configuration.
- Stryker covers the deduplication nightly (brief 13.5).

## Implementation notes (plan TP5, 2026-09-29)

- The exact duplicate check uses `normalizeClaimText` from `@lfc/service-kit` (moved there from the gateway), not a stop-word-free hash: removing stop words would merge "ist" and "ist nicht".
- `detectMs` is measured from receiving the final segment to publishing the claim; STT finalisation is not included.
- The classifier sees the window for every provider, Jev included; speakers are letters (owner decision 2026-09-29).
- Defaults: window 6 segments, at least 5 words, checkworthiness ≥ 3 of 5, confidence high 0.75 / low 0.5, 10 duplicate candidates.

## Amendment 2026-09-30: rhetorical questions

Owner decision: accusations phrased as rhetorical questions must be detected. A question with a negation (`nicht`, `kein…`, `nie`, `niemals`) passes the pre-filter; the classifier's claim question counts a rhetorical question that insinuates a checkable fact as a claim of that fact, and the standalone prompt turns it into a statement ("X hat … gesagt") without confirming it. Genuine questions ("Wie hoch ist …?", "Stimmt es, dass …?") are still dropped by the pre-filter. Cost: negated genuine questions ("Warum kommst du nicht?") now reach the classifier; the detection eval shows whether that matters. The detection set labels rhetorical questions accordingly (`evals/README.md`, label rule). Superseded for the pre-filter by the amendment of 2026-10-02.

## Amendment 2026-10-02: every question reaches the classifier

Owner decision after the live test of 2026-10-01 (plan `.ai/plans/feature-erkennung-absatz.md`, task E1): the pre-filter no longer drops questions. This deviates from brief 8.1, which lists questions among the pre-filter heuristics. Reasons: a leading interrogative is no sign of a question ("Was uns empört, ist, dass …" opens a claim, and the detection set lost one real claim this way), and rhetorical questions insinuate facts without any negation ("Wer hat denn die Mieten verdoppelt?"). Only the classifier can tell them from genuine questions, which its claim question already does; the negation rule of 2026-09-30 is folded into this. Greetings, filler openers and opinion markers without a fact signal are still dropped (owner, same day). Cost: one classifier call per question at the configured classifier's price (Jev $0.042 per 1M input tokens; the `llm` classifier pays the extractor LLM's price, e.g. $1 per 1M input tokens for `claude-haiku-4-5`); the daily budget caps it. On the detection set all 47 positive segments now pass the pre-filter (46 before), and four genuine questions reach the classifier; the effect on precision shows in the conversation baseline of task E2.

