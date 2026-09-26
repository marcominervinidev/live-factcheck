# @lfc/contracts

Versioned zod schemas for every event and API payload of live-factcheck. Types are inferred from the schemas; services validate everything they publish and consume against them.

| Schema | Stream / use | Version |
|---|---|---|
| `TranscriptSegment` | `transcript.segments` | 1 |
| `ClaimDetected` | `claims.detected` | 2 |
| `ClaimChecked` (with `Evidence`, `VerdictProbabilities`) | `claims.checked` | 2 |
| `ClaimExplained` | `claims.explained` | 1 |
| `TopicDetected` | `topics.detected` (from phase 4) | 1 |
| `EventEnvelope` | wrapper `{ type, schemaVersion, payload }` on streams and `session:{sessionId}:events` | 2 |
| `CheckClaimRequest`, `CheckClaimAccepted` | `POST /api/claims/check` | 1 |
| `ProviderStatus` | `GET /api/status` | 1 |
| `ApiError` | body of every HTTP error | 1 |
| `WsClientMessage`, `WsServerMessage` | `/ws/session` | 1 |

```ts
import { EventEnvelope, STREAMS } from '@lfc/contracts';

const event = EventEnvelope.parse(JSON.parse(raw));
if (event.type === 'claim.checked') {
  console.log(event.payload.verdict, event.payload.confidenceLevel);
}
```

Formats and rules: [ADR 0002](../../docs/adr/0002-event-contract-format.md), v2 events and API v1: [ADR 0010](../../docs/adr/0010-contracts-v2-and-api-v1.md). Changing a contract: see [AGENTS.md](./AGENTS.md).
