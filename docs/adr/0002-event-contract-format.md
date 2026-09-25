# 0002: Event contract format

- Status: accepted
- Date: 2026-09-25

## Context

All events and API payloads are zod schemas in `packages/contracts` (brief 4, 7). Section 7 lists the fields but not their formats. The contracts are read-only for agents once they exist (4.2), so the formats must be settled before any service consumes them. Events travel through Redis Streams and Pub/Sub, are delivered at least once and may be read by consumers of a different version during a rollout.

## Decision

**Field formats**

| Field | Format |
|---|---|
| `schemaVersion` | integer literal per schema, starts at `1` |
| `sessionId`, `segmentId`, `claimId` | UUID v4 (`crypto.randomUUID()`) |
| `detectedAt`, `checkedAt` | ISO 8601 date-time in UTC with `Z` suffix |
| `language` | BCP 47 tag, e.g. `de` or `de-DE` |
| `startMs`, `endMs` | non-negative integers, milliseconds since session start, `endMs >= startMs` |
| `speaker` | 1–64 characters, e.g. `A` (diarization label, renamed only in the UI) |
| free text (`text`, `claim`, `normalizedText`) | non-blank, bounded length |
| `sources[].url` | absolute `http` or `https` URL |

**Semantic rules in the schema**

- All objects are strict: unknown fields are rejected, so drift between producer and consumer shows up as a validation error instead of silently lost data.
- The only optional field is `sources[].snippet`.
- `explanation` has at most two sentences and at most 400 characters. Sentence counting ignores single-letter abbreviations such as "z. B.". That it is German is a prompt rule, not checked by the schema.
- A `ClaimChecked` with a verdict other than `nicht_pruefbar` must cite at least one source (brief 9.4: the LLM judges only on the sources it was given).
- `ClaimDetected.sourceSegmentIds` may be empty: claims from the text mode (brief 6.8) have no transcript segments.

**Envelope**

Streams and the Pub/Sub channel carry `{ type, schemaVersion, payload }`. `type` names the event (`transcript.segment`, `claim.detected`, `claim.checked`), `schemaVersion` versions the envelope itself, and the payload keeps its own `schemaVersion`. Consumers validate with the discriminated union `EventEnvelope` and dispatch on `type`.

**Names**

Stream names (`transcript.segments`, `claims.detected`, `claims.checked`) and the channel name `session:{sessionId}:events` are exported constants from the contracts package, so no service spells them by hand.

## Alternatives

- **ULID instead of UUID v4:** sortable by time, which helps when reading streams, but needs a dependency; Redis stream IDs already give ordering.
- **Epoch milliseconds for timestamps:** compact, but unreadable in logs and Redis tooling.
- **Lenient (non-strict) objects:** tolerate additive changes, but hide mistakes. Additive changes go through a new `schemaVersion` instead.
- **Version only on the envelope:** simpler, but the brief asks for a `schemaVersion` on each schema, and payloads are also used outside the envelope (HTTP responses).

## Consequences

- Every contract change needs a new `schemaVersion`, an ADR and updated contract tests in its own commit; a CI check enforces this (T2.4).
- During a rolling update, consumers must accept the old and the new version of a payload until all producers are updated. How that is handled is decided with the first real version bump.
- The sentence heuristic for `explanation` can misjudge unusual abbreviations; if it rejects valid LLM output in practice, the rule is revisited with an ADR.
