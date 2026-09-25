# @lfc/contracts

Versioned zod schemas for every event and API payload of live-factcheck. Types are inferred from the schemas; services validate everything they publish and consume against them.

| Schema | Stream / use | Version |
|---|---|---|
| `TranscriptSegment` | `transcript.segments` | 1 |
| `ClaimDetected` | `claims.detected` | 1 |
| `ClaimChecked` | `claims.checked` | 1 |
| `EventEnvelope` | wrapper `{ type, schemaVersion, payload }` on streams and `session:{sessionId}:events` | 1 |

```ts
import { EventEnvelope, STREAMS } from '@lfc/contracts';

const event = EventEnvelope.parse(JSON.parse(raw));
if (event.type === 'claim.checked') {
  console.log(event.payload.verdict);
}
```

Formats and rules: [ADR 0002](../../docs/adr/0002-event-contract-format.md). Changing a contract: see [AGENTS.md](./AGENTS.md).
