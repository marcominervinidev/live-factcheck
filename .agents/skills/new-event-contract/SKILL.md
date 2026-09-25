---
name: new-event-contract
description: "Add or change an event/API schema in packages/contracts with schemaVersion, contract tests, ADR and docs. Only after the owner has explicitly approved the contract change."
---

# New or changed event contract

`packages/contracts` is read-only for agents (brief 4.2). Start only when the owner has approved the change in this conversation. If not, stop and propose the change with a reason instead.

## Steps

1. **ADR first** (skill `adr`): why the contract is needed or changes, the fields and their formats, compatibility during rollout.
2. **Schema** in `packages/contracts/src/<kebab-name>.ts`, following ADR 0002 and the existing files:
   - `z.strictObject({ schemaVersion: z.literal(<n>), … })`; new schemas start at `1`, a changed schema gets `<old + 1>`
   - reuse building blocks from `src/common.ts` (`Uuid`, `IsoDateTimeUtc`, `Speaker`, `text(max)`, `HttpUrl`, …)
   - cross-field rules via `.refine` with a `path`
   - `export const X = …; export type X = z.infer<typeof X>;`
3. **Export** both from `src/index.ts`.
4. **Envelope:** if the event travels on a stream or the session channel, add it to `EventEnvelope` in `src/envelope.ts` with its `type` name, and add the stream name to `STREAMS` if it is a new stream.
5. **Fixture:** a valid example in `src/testing/fixtures.ts`.
6. **Contract tests** in `src/<kebab-name>.test.ts`: the valid example parses; one failing case per rule (wrong type, missing required field, unknown field, each refine); JSON round-trip through the envelope.
7. **Docs:** update the table in `packages/contracts/README.md`.
8. **Verify:** `scripts/tb pnpm --filter @lfc/contracts test:unit`, `scripts/tb pnpm typecheck`, and `scripts/check-contract-change.sh origin/main` must pass.
9. **Commit** the contract change on its own: `feat(contracts): …` or `feat(contracts)!: …` for a breaking change. Consumers are updated in separate commits.
