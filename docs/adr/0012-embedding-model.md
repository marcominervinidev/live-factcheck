# 0012: Embedding model

- Status: proposed (open – decided after the phase 1 retrieval measurement)
- Date: 2026-09-26

## Context

Brief 9.2: embeddings rank chunks for a claim (phase 1, in memory) and later power the evidence store and the semantic verdict cache (phase 4). The model must be multilingual with good German coverage and run locally via LM Studio or Ollama (OpenAI-compatible `/embeddings`), with a cloud option.

## Decision (so far)

- Adapter `EmbeddingProvider` with `openai-compatible` (local default) and `mock` (hashed bag-of-words, deterministic). Config `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_API_KEY` (secret, cloud only).
- The model is config only. The dimension is read from the first response and stored with every vector, so a model change cannot silently mix vector spaces.
- Candidates for the measurement: `bge-m3` (1024 dims, strong German, in the Ollama library), `multilingual-e5-large` (needs `query:`/`passage:` prefixes – the adapter supports an optional prefix pair in config), Qwen3-Embedding 0.6B.
- Measurement: on the claim eval set, the share of claims whose best evidence (by the verdict classifier) is in the embedding top-k, plus latency per batch on the owner's Mac.

## Open

Which model becomes the documented default. Decided with the eval report at the end of phase 1; this ADR is then set to accepted.

## Consequences

- Until decided, `.env.example` names `bge-m3` as an example only.
- Changing the model later requires re-embedding the phase 4 store (the stored dimension/model tag makes this detectable).
