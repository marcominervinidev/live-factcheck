# AGENTS.md – packages/contracts

Rules for this package only. Repo-wide rules: `/AGENTS.md`. Format decisions: `docs/adr/0002-event-contract-format.md`.

- **Read-only for agents.** Do not change a schema to make an implementation or test pass. Stop and propose the change with a reason.
- An approved change is its own commit containing: the schema change, a higher `schemaVersion` literal for that schema, updated contract tests, and a new or updated ADR. CI (`scripts/check-contract-change.sh`) rejects contract changes without an ADR and version bump.
- Schemas are `z.strictObject`. Never switch to lenient objects, never make a required field optional, never widen an enum without a version bump.
- Export each schema and its inferred type under the same name from `src/index.ts`. Other workspaces import only from `@lfc/contracts`, never from `src/*`.
- Stream and channel names come from `STREAMS` and `sessionEventsChannel()`; never spell them elsewhere.
- Tests: every schema has a test with a valid example and one failing case per rule. Fixtures live in `src/testing/` and are not exported.
- No runtime dependencies besides `zod`.
