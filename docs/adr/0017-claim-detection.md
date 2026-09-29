# 0017: Claim detection in the live transcript

- Status: accepted (Marco, Gate 0, 2026-09-29)
- Date: 2026-09-29

## Context

Brief 5, 6.5 and 8.1 describe the `claim-extractor`: a rolling window of recent segments per session, a deterministic pre-filter against small talk, a classifier deciding whether a segment contains a checkworthy factual claim, an LLM that rewrites positive cases into a standalone statement (pronouns and references resolved), and deduplication per session. Precision matters most live, because false alarms flood the feed (13.5). Workers must stay stateless (factor VI) and idempotent (at-least-once streams, `.ai/summaries/pipeline-streams.md`).

## Decision

**Input:** consumer group `claim-extractor` on `transcript.segments` (final segments only).

**Window:** per session the last `DETECTOR_WINDOW_SEGMENTS` (default 6) final segments, stored in Redis (`extractor:v1:window:{sessionId}`, list trimmed on write, TTL = session TTL). Sorted by `startMs` when read. The window gives context for resolving references; the decision is made for the newest segment.

**Pre-filter (deterministic, unit-tested):** drop a segment when it is shorter than `DETECTOR_MIN_WORDS` (default 5), is a question, consists of greetings or filler, or is pure opinion ("ich finde", "meiner Meinung nach" without a number, date, named entity or comparison). The rules are data in `services/claim-extractor/src/prefilter.ts` with German test cases; every drop is counted by reason (metric).

**Classifier (`ClassifierProvider`, ADR 0007):** one call with two questions on the state "window + newest segment" – for every classifier provider, Jev (`typesafe`, USA) included; speaker names are always replaced by the letters `A`, `B`, … before the state leaves the service (owner decision 2026-09-29, brief 15.6): Bool "the newest segment contains a checkable factual claim" and Score "checkworthiness 1–5". Configuration `DETECTOR_CLASSIFIER_PROVIDER` (`llm` default, `typesafe`, `mock`), the `llm` classifier uses `EXTRACTOR_LLM_*`. Thresholds `DETECTOR_CONFIDENCE_HIGH` / `DETECTOR_CONFIDENCE_LOW` (start 0.75 / 0.5, tuned with the detection eval): below low → dropped; between → dropped too (precision first), counted as "uncertain" for the eval; high and score ≥ `DETECTOR_MIN_SCORE` (default 3) → positive. `checkworthiness` in the event = score mapped to 0..1.

**Standalone formulation (`EXTRACTOR_LLM_*`):** only for positive cases. Prompt `services/claim-extractor/prompts/standalone.md` (versioned, placeholders, segments passed as delimited data like in the fact-checker); output schema `{ standaloneText, originalText }`; the text must be one German sentence, at most 300 characters; invalid after one repair attempt → the claim is dropped and counted (no guess).

**Deduplication per session:** (1) normalised hash of `standaloneText` (lower case, numbers kept, punctuation and stop words removed) against a Redis set `extractor:v1:claims:{sessionId}`; (2) if no exact hit, compare with the last `DETECTOR_DEDUP_CANDIDATES` (default 10) claims of the session by token overlap (Jaccard ≥ 0.6) and confirm with the classifier's Bool "both statements have the same truth value" (protects against different numbers or negation, brief 8.1). Duplicates are dropped and counted.

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
