# Research pipeline: SearXNG, fetching, SSRF, extraction (research, 2026-09-26)

## SearXNG (already in the stack)

- `GET http://searxng:8080/search?q=<query>&format=json&language=de` → `{ results: [{ url, title, content, engine, score }] }`. JSON format is enabled in `deploy/compose/searxng/settings.yml`.
- Only reachable on `internal`; the fact-checker already sits there.

## Fetching pages safely (brief 9, 15.5)

The URLs come from search results, i.e. from strangers. Guard (`packages/research/src/fetch/safe-fetch.ts`):

1. Only `http:` / `https:`; no credentials in the URL; ports 80/443 only.
2. Resolve the host with `dns.lookup(host, { all: true })`; reject if **any** address is loopback, private (RFC 1918, fc00::/7), link-local (169.254/16 incl. cloud metadata 169.254.169.254, fe80::/10), CGNAT (100.64/10), unspecified, multicast or IPv4-mapped variants of these. Implemented with Node's `net.BlockList`.
3. Reject internal hostnames outright: `localhost`, `*.local`, `*.internal`, `host.docker.internal`, and single-label names (`redis`, `postgres`, `searxng`, `gateway`, …).
4. **Pin the connection to the validated IP** (undici 8 `Agent` with a custom `connect.lookup`) so a DNS change between check and connect (rebinding) cannot reach an internal address.
5. Redirects manually (`redirect: "manual"`), at most 3, each hop re-validated from step 1.
6. Limits: timeout (`CHECKER_FETCH_TIMEOUT_MS`), max body bytes (`CHECKER_FETCH_MAX_BYTES`, read as a stream and aborted when exceeded), `content-type` must be `text/html` or `text/plain`.
7. Own `User-Agent` (`live-factcheck/<version> (+repo URL)`), and robots.txt respected via a small in-house RFC 9309 matcher (`packages/research/src/fetch/robots-rules.ts`; `robots-parser` 3.0.1 was dropped because its typings collapse to `any`). robots.txt itself is fetched through the same guard and cached per origin in Redis.

## Main-text extraction

`@mozilla/readability` 0.6.0 on a `jsdom` 30 document (scripts disabled, no resource loading). Output: title + text, whitespace-normalised, truncated to `CHECKER_MAX_SOURCE_CHARS`. Each source gets an id `S1…Sn` for citations.

## Prompt injection (brief 15.5)

- Source text goes into the prompt inside clearly delimited data blocks (`<source id="S1" url="…">…</source>`), with the instruction that source content is data, never instructions.
- The LLM has no tools. The output must pass the zod schema; every cited `url` must be one of the fetched source URLs, otherwise the result is discarded (→ `nicht_pruefbar`, reason `uncited_or_foreign_source`).

## Network

The fact-checker needs `egress` for page fetches and cloud LLMs, plus `internal` for Redis/SearXNG. Being on `egress` also gives it `host.docker.internal` (LM Studio/Ollama). The SSRF guard is what keeps fetched URLs away from internal targets; the network alone cannot.
