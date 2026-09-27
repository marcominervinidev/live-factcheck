# Summary: `packages/contracts` (state after phase 0)

**Responsibility:** zod schemas for every event and API payload; types are `z.infer` of them (brief 4.2, 7). Read-only for agents unless the owner approves a change (ADR + higher `schemaVersion` + contract tests, own commit; CI check `scripts/check-contract-change.sh`).

**Existing schemas (all `schemaVersion: 1`, `strictObject`):**
- `common.ts`: `Uuid` (v4), `IsoDateTimeUtc`, `LanguageTag`, `Speaker`, `text(max)` (non-blank), `HttpUrl`, `OffsetMs`.
- `TranscriptSegment` (endMs ≥ startMs).
- `ClaimDetected` v1: `text`, `normalizedText`, `sourceSegmentIds` (empty in text mode).
- `ClaimChecked` v1: `verdict`, `confidence` (enum hoch/mittel/niedrig), `explanation` (≤ 2 sentences, `countSentences`), `sources[]`; rule: every verdict except `nicht_pruefbar` needs a source.
- `envelope.ts`: `{ type, schemaVersion, payload }`, discriminated union `EventEnvelope`; `STREAMS` (`transcript.segments`, `claims.detected`, `claims.checked`); `sessionEventsChannel(id)` = `session:{id}:events`.
- `src/testing/fixtures.ts`: valid fixtures used by tests of other packages.

**Phase 1 (approved 2026-09-26):** `ClaimDetected` v2, `ClaimChecked` v2 (no explanation; probabilities, evidence, cacheHit, timings), `ClaimExplained` v1, `TopicDetected` v1, `Evidence`, API/WS v1; new streams `claims.explained`, `topics.detected`.

**Pitfalls:**
- The envelope's `schemaVersion` is the envelope version, the payload has its own.
- The sentence counter undercounts on purpose (German abbreviations, dates).
- Stryker score for this package is unreliable (refine callbacks); see plan T7.5.
