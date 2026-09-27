# Evidence sources and embeddings (research, 2026-09-26)

Complements `research-pipeline.md` (SearXNG, safe fetch, extraction, prompt injection). Sources: Google Fact Check Tools API reference, MediaWiki REST API reference, OpenAI embeddings API shape (served by LM Studio and Ollama).

## Tier 1: Google Fact Check Tools API (brief 9.1)

- `GET https://factchecktools.googleapis.com/v1alpha1/claims:search?query=…&languageCode=de&pageSize=…&maxAgeDays=…`
- Auth: API key. Send it as header `X-Goog-Api-Key` (standard for Google APIs), **never as `?key=`** – tokens never in URLs (brief 15.5).
- Response `{ claims: [{ text, claimant, claimDate, claimReview: [{ publisher: { name, site }, url, title, reviewDate, textualRating, languageCode }] }], nextPageToken }`.
- Mapping: each `claimReview` → `Evidence` with `tier: "faktencheck"`, `snippet` = claim text + rating; the best match fills `ClaimChecked.existingFactCheck { publisher, url, rating }`. The review URL is **not** fetched in phase 1 (the rating is the evidence; fetching would add scraping of publisher sites).
- Secret `google_factcheck_api_key`; tier disabled when unset (logged at start, visible in `/api/status`).

## Tier 2: Wikipedia (de) and Wikidata

- Search: `GET https://de.wikipedia.org/w/rest.php/v1/search/page?q=…&limit=3` → `pages[{ id, key, title, excerpt, description }]`.
- Text: `GET https://de.wikipedia.org/w/rest.php/v1/page/{key}/html` → HTML, then the same readability/chunking path as web pages (no separate parser).
- Wikidata: `GET https://www.wikidata.org/w/api.php?action=wbsearchentities&search=…&language=de&format=json` then `action=wbgetentities&ids=…&props=labels|descriptions|claims&languages=de`. Phase 1 uses Wikidata only for **labels + descriptions + a small allowlist of date/number properties** (P569 birth, P570 death, P571 inception, P580/P582 start/end, P1082 population), rendered as short German text snippets. Full SPARQL is out of scope (no plan item needs it).
- Wikimedia requires a descriptive `User-Agent` with contact URL; we send `live-factcheck/<version> (+<repo URL>)`, same as page fetches. No key.
- Both endpoints are fixed allowlisted hosts; they still go through the safe fetch (one code path, SSRF rules apply everywhere).

## Tier 3: web search

SearXNG (existing, `research-pipeline.md`); `brave`/`tavily` stay optional adapters behind the same `SearchProvider` interface and are **not** built in phase 1 (brief: optional; no plan item). Search results → safe fetch → readability → chunks.

## Source tiers (`config/source-tiers.yaml`)

Data, not code (brief 9.1): list of `{ tier, weight, domains: [suffix…] }`, e.g. `faktencheck` (correctiv.org, dpa-factchecking.com, mimikama.org), `amtlich` (bund.de, destatis.de, bundestag.de, europa.eu), `referenz` (wikipedia.org, wikidata.org), `presse` (tagesschau.de, zeit.de, …), everything else `sonstige`. Matching by registrable-domain suffix; weight multiplies the ranking score. Validated with zod at service start (fail fast); path-level rules are not supported in phase 1.

## Chunking (brief 9.2)

300–500 tokens with overlap. No tokenizer dependency in phase 1: approximate tokens as `ceil(chars / 4)` for German text, split on paragraph → sentence boundaries, target 400 ± 100, overlap 1 sentence (~50 tokens). Each chunk: `{ url, publisher, publishedAt?, retrievedAt, tier, text }`. Only a short snippet (≤ 300 chars, sentence-aligned) ever leaves the service (events, UI).

## Embeddings (brief 9.2)

- OpenAI-compatible `POST {baseURL}/embeddings { model, input: string[] }` → `data[{ index, embedding: number[] }]`; LM Studio and Ollama both serve it (`openai` SDK `client.embeddings.create`).
- Candidate multilingual models (decision in the open ADR, measured by the eval's retrieval hit rate): `bge-m3` (Ollama library, 1024 dims, strong German), `multilingual-e5-large` (needs `query:`/`passage:` prefixes), Qwen3-Embedding 0.6B. Config: `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_API_KEY` (cloud only).
- `mock` embeddings: deterministic hashed bag-of-words vectors (so similar texts are close in tests without a model).
- Phase 1 ranking: cosine similarity claim ↔ chunk × tier weight → top-k → classifier Bool "relevant" per chunk (one fan-out call) → Bool "sufficient" → Choice verdict + Choice best snippet.
