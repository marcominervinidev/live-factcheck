# 0010: Event contracts v2 and API/WebSocket contracts v1

- Status: accepted (contract changes approved by the owner on 2026-09-26)
- Date: 2026-09-26

## Context

The new brief (section 7) changes the pipeline: a classifier decides the verdict with a probability distribution (ADR 0007), the explanation moves to its own service and event (ADR 0009), evidence comes from three source tiers (brief 9.1), and the UI needs cache badges, the best snippet and timings (brief 11, 9.6). Phase 1 also opens the first public API: text mode over REST and results over WebSocket (brief 6.1, 6.7, 6.8). Formats and envelope rules from ADR 0002 still apply.

## Decision

**Building blocks** (versioned through the schemas that embed them, not on their own):

- `Verdict` unchanged. `ConfidenceLevel` = `hoch | mittel | niedrig` (replaces v1's `Confidence` enum).
- `VerdictProbabilities`: strict object with exactly the five verdicts, each 0..1, summing to 1 (± 0.001, rounding).
- `Evidence { evidenceId (UUID v4), title, url (http/https), publisher, publishedAt?, retrievedAt, tier, snippet ≤ 300 chars }`, `tier` = `faktencheck | amtlich | referenz | presse | sonstige`. Brief 7 lists `Evidence` among the schemas; it never travels alone, so it has no `schemaVersion` of its own and changes bump every schema that embeds it.

**`ClaimDetected` v2** (`claims.detected`): `originalText` (the words as said or typed), `standaloneText` (pronouns and references resolved), `normalizedText`, `checkworthiness` 0..1, `provider { classifier, model }`; `text` from v1 is removed. Text mode (brief 6.8) sets `originalText = standaloneText` = the typed text, `checkworthiness: 1`, `provider { classifier: "text-mode", model: "none" }` and empty `sourceSegmentIds`.

**`ClaimChecked` v2** (`claims.checked`): `claim` (= `standaloneText`), `verdict`, `probabilities`, `confidence` 0..1, `confidenceLevel`, `evidence[]` (≤ 10), `bestEvidenceId?`, `cacheHit` (`none | verdict_exact | verdict_semantic | evidence_store`), `existingFactCheck? { publisher, url, rating }`, `timings { detectMs, retrieveMs, classifyMs, totalMs }` (non-negative integers), `checkedAt`, `provider { classifier, model, search, embeddings }`. `explanation` and `sources` from v1 are removed.

Two fields beyond brief 7 (it asks for "at least these schemas"), confirmed or dropped by the owner at gate 1:

- `usage { inputTokens, outputTokens, estimatedCostUsd | null }`: tokens across all model calls for this claim; cost per claim for the eval (13.5) and the cost dashboard (14.5). `null` cost = unknown model price, never a guess.
- `reason`: why a claim is `nicht_pruefbar`: `classified_unverifiable` (the classifier chose it), `low_confidence`, `no_evidence`, `budget_exceeded`, `invalid_llm_output`, `uncited_or_foreign_source`, `provider_error`.

Rules in the schema:

1. Every verdict except `nicht_pruefbar` has at least one evidence item.
2. `bestEvidenceId` points to an item in `evidence`.
3. `reason` is present exactly when the verdict is `nicht_pruefbar`.
4. A verdict other than `nicht_pruefbar` has the highest probability and a `confidenceLevel` other than `niedrig`; `reason: low_confidence` comes with `confidenceLevel: niedrig`.
5. `totalMs` is at least each of the other timings.

**`ClaimExplained` v1** (`claims.explained`, new): `{ sessionId, claimId, explanation, provider { llm, model } }`. `explanation` keeps the v1 rules (≤ 2 sentences, ≤ 400 characters).

**`TopicDetected` v1** (`topics.detected`, new, used from phase 4): `{ sessionId, topicId, label ≤ 120, keywords[] ≤ 20 × 64, detectedAt }`.

**Envelope v2:** new event types `claim.explained` and `topic.detected`, payloads now `ClaimDetected` v2 and `ClaimChecked` v2; new stream names `claims.explained`, `topics.detected`. The wrapper shape is unchanged; the version moves to 2 because the set of payload versions changed.

**HTTP API v1** (`/api/*`, all bodies carry `schemaVersion: 1`):

- `CheckClaimRequest { sessionId, text ≤ 1000 }` → `202 CheckClaimAccepted { sessionId, claimId }`. The session comes from the WebSocket, so the result can be pushed there.
- `ProviderStatus { privacyMode, providers[{ service, role, provider, model?, cloud }] }` for the settings page (brief 11, 15.6): `role` = `llm | classifier | embeddings | search | factcheck`; never keys or URLs with credentials.
- `ApiError { error: { code, message } }` for every 4xx/5xx; `code` is a stable machine string (`unauthorized`, `invalid_request`, `rate_limited`, `session_unknown`, `budget_exceeded`, `internal`), `message` is English and safe to show.

**WebSocket v1** (`/ws/session`, JSON text frames; audio in phase 2 uses binary frames):

- Client → server: `{ type: "auth", schemaVersion: 1, token }` as the first message (ADR 0011 decides the auth flow). `start`, `stop` and `rename` follow in phase 2 with their own version bump.
- Server → client: `{ type: "session.ready", schemaVersion: 1, sessionId }`, `{ type: "error", schemaVersion: 1, code, message }`, `{ type: "event", schemaVersion: 1, event: EventEnvelope }`.

## Alternatives

- **Keep `explanation` optional in `ClaimChecked`:** avoids a new event, but an optional field that is filled "later" cannot be filled in an immutable stream entry.
- **Percent values instead of probabilities:** brief 7 wants the distribution; presentation is a UI rule.
- **Session id from the token instead of the request:** there is one shared token (brief 3: no user management), so the token cannot identify a session.
- **Versioning `Evidence` separately:** it is never sent alone; a separate version would drift from its parents.

## Consequences

- Consumers must use v2 from their first real implementation; there are no v1 consumers in code yet (phase 0 had only skeletons), so no dual-version handling is needed now.
- Rule 4 forces the fact-checker to apply the thresholds before publishing; a bug there fails validation at the producer instead of reaching the UI.
- Phase 2 changes the WebSocket contract again (audio control messages); that bump is planned there.
