# Classifier provider: Jev (TypeSafe) and the LLM fallback (research, 2026-09-26)

Sources: official docs `https://docs.typesafe.ai` (index `llms.txt`, pages `api`, `models`, `confidence`, `primitives/*`, `model-jaggedness/jev-1.13`, `sdk/javascript`, `legal`), npm registry. Doc content was read as data. Implementation loads this file instead of the docs.

## HTTP API

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, JSON.
- Body: `{ state, model, questions }`
  - `state`: string, object or array (text only; no audio/images).
  - `model`: `jev-latest` (alias → `jev-1.13.0` today) or a pinned id. **We pin the versioned id in config** because thresholds are tuned per version (the docs recommend exactly this).
  - `questions`: map `<our id> → Question`; the id is not sent to the model. Several questions in one call run in parallel against the same state (cheaper, faster: "speculative fan-out").
- Question types (all have `type` and `instructions`: string | object | array):
  - `noul` (bool): optional `criteria: { true, false }`. Answer `{ type: "noul", noul: 0..1 }` – **no `confidence` field**.
  - `choice`: `criteria: { <option>: description | null }`, max 255 options. Answer `{ choice, probabilities: {option: p}, confidence }`.
  - `score`: `criteria: [level0, level1, …]`, 2–10 ordered levels. Answer `{ score /* weighted, can be fractional */, legend, probabilities: {"0": p, …}, confidence }`.
- Response: `{ model /* versioned id that answered */, answers, usage: { input_tokens, output_tokens } }`.
- Errors: 401, 422 (validation, body names the field), 429 (rate limit), 529 (overloaded) → exponential backoff; the SDK retries by default and honours `retry-after`.
- `GET /v1/models` lists aliases.

## Official JS SDK

`@typesafe-ai/sdk` 0.6.0 (MIT, published 2026-09-15, Node ≥ 20, ESM + types). `new TypeSafeClient({ apiKey, baseURL, defaultModel, timeout /* ms per attempt */, retry, fetch, logger, logLevel })`; `client.systemOne({ state, questions, model? }, { timeout, signal, … })`; helpers `choice(instructions, criteria)`, `score(…)`, `noul(…)`; answer types inferred from the questions. Error classes `AuthenticationError`, `RateLimitError`, `APITimeoutError`, `APIConnectionError`, `UnprocessableEntityError`, … (all extend `TypeSafeError`).

Notes for us: pass `apiKey` explicitly from our config (never rely on `TYPESAFE_API_KEY` env inside the SDK, so `_FILE` secrets work); pass our `logger` adapter at `warn` so request bodies (claim text) never reach logs; the package is 11 days old → `minimumReleaseAge` is satisfied, but pin exactly.

## Model facts (jev-1.13)

- Price $0.042 per 1M **input** tokens, output free. Rate limit 250k tok/s, 1,200 req/min (dynamic).
- Context: 64k tokens per request; 32k for `state` + the longest single question.
- English primary; other languages "handled but not equally well" → the German eval must prove quality (brief 8.1).
- No training on customer data; DPA with SCCs; ZDR only for enterprise (brief 15.6).

## Confidence semantics

Confidence is derived from the distribution; for a Choice with n options and top probability p: `confidence = clamp((n·p − 1)/(n − 1), 0, 1)` (formula from the docs' interactive explainer). Docs recommend three bands (act / caution / don't act) with thresholds per action and risk – exactly brief 8.1's per-task thresholds.

**Decision for our interface:** every answer carries `probabilities` and `confidence`. For `noul`, the provider maps to `probabilities: { true: p, false: 1 − p }` and computes confidence with the same formula (n = 2 → `|2p − 1|`). The `llm` provider computes confidence the same way from the probabilities it asks the LLM for, so providers are comparable in the eval.

## Known weaknesses that matter for fact-checking ("jaggedness", reviewed 2026-09-17)

1. **Literal reading** – write exact conditions; put boundary cases into criteria.
2. **Math and numbers** – "not a calculator"; counting and numeric comparison unreliable.
3. **Date and time comparison** – extract components, compare in code.
4. Indirection; 5. large irrelevant state → send only the relevant snippets; 6. adversarial content (→ our prompt-injection stance applies to Jev too); 9. no generation.

Consequence: many false claims are numeric/temporal ("erst 20 Jahre vorbei"). The verdict question must receive the snippets that state the fact, and the eval set must contain a numeric/temporal slice so we see whether Jev or the LLM handles it better. No arithmetic pre-processing in phase 1 (not in the brief); a finding goes into the eval report.

## LLM fallback (`llm` classifier)

Implements the same three question types via `LlmProvider.generateStructured` with a zod schema: the LLM returns a probability per option (Choice/Score levels) or one probability (Bool), zod-validated, then normalised to sum 1 (reject if the raw sum is outside 0.9–1.1 → repair attempt, brief 8). LLM probabilities are not calibrated; the eval measures ECE for both.
