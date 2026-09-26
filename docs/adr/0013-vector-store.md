# 0013: Vector store for the evidence store

- Status: proposed (open – decided at the start of phase 4)
- Date: 2026-09-26

## Context

Brief 9.3: from phase 4, chunks with embeddings are persisted and retrieved hybrid (vector search plus German full-text search, results merged), with per-fact validity. The brief proposes Postgres with pgvector and asks to evaluate Qdrant and Redis vector search.

## Options to evaluate

| Option | For | Against |
|---|---|---|
| Postgres + pgvector | one database for sessions, claims, verdicts and evidence; German full-text search (`tsvector` with `german` config) in the same query; mature backups | needs index tuning (HNSW) at larger sizes |
| Qdrant | purpose-built, fast filtering, hybrid search via sparse vectors | second stateful system to run, back up and secure; German full-text is not its strength |
| Redis vector search (Redis Query Engine) | already in the stack, low latency | memory-bound, persistence and backups weaker than Postgres; full-text German stemming limited |

## Decision

Not decided in phase 1: phase 1 ranks in memory and discards the chunks (brief 9.3). The phase 4 plan starts with a short spike (recall and latency on the eval set, operational cost) and turns this ADR into accepted.

## Consequences

- Phase 1 code keeps retrieval behind an interface in `packages/research` (`rankChunks`) so phase 4 swaps the in-memory ranking for a store query without touching the fact-checker flow.
