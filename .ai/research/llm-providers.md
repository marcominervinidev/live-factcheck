# LLM providers for phase 1 (research, 2026-09-26)

Sources: the claude-api reference bundled with Claude Code (SDK usage, model table cached 2026-06-24), npm registry for versions. Implementation loads this file instead of re-reading the docs.

## Anthropic (`@anthropic-ai/sdk` 0.128.0)

- **Structured output:** `client.messages.parse({ model, max_tokens, messages, output_config: { format: zodOutputFormat(schema) } })` from `@anthropic-ai/sdk/helpers/zod`. The response carries `parsed_output` (null if parsing failed – always guard). `output_format` at the top level is deprecated.
- **Stop reasons to handle:** `end_turn` (ok), `max_tokens` (truncated → treat as failure, one repair attempt), `refusal` (check `stop_details.category`; map to `nicht_pruefbar`, never crash).
- **No assistant prefill** on current models (400). Format is controlled by structured outputs, not prefill.
- **Thinking:** adaptive by default on Opus 5 (`thinking` omitted = adaptive). Effort via `output_config.effort` (`low` … `max`). Extraction: `low`; verdict: `medium` as the starting point, tuned with the eval set.
- **Errors:** typed classes (`Anthropic.RateLimitError`, `APIError` with `status`, `APIConnectionError`). SDK retries 408/409/429/5xx and connection errors, default `maxRetries: 2`; `timeout` in **milliseconds** (TS), per request via the second argument. Our config: `<TASK>_LLM_TIMEOUT_MS`, `<TASK>_LLM_MAX_RETRIES`.
- **Usage for cost:** `response.usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.
- **Prompt caching:** the system prompt is stable, so top-level `cache_control: { type: "ephemeral" }` makes repeated verdicts cheaper; verify with `cache_read_input_tokens`.
- **Refusal fallbacks** (`fallbacks: "default"`, beta header `server-side-fallback-2026-07-01`): available for Opus 5; enabled by default in our adapter, reported in the response metadata.

### Models and prices (per 1M tokens, first-party API)

| Use | Example model id (config only, never hard-coded) | Input | Output |
|---|---|---|---|
| Extraction (fast, cheap) | `claude-haiku-4-5` | $1 | $5 |
| Verdict (strong) | `claude-opus-5` | $5 | $25 |
| Alternative verdict | `claude-sonnet-5` | $2 | $10 |

Prices live in a small table in `packages/providers` keyed by model id, used only for the eval's cost column; an unknown model reports "cost unknown" instead of guessing.

### Native research mode (deferred, decision 2026-09-26)

Server tool `{ type: "web_search_20260209", name: "web_search", max_uses, allowed_domains | blocked_domains }` (dynamic filtering; Opus 5 / Sonnet 5). Results arrive as `web_search_tool_result` blocks; an error arrives as an object in `content`, not as an exception. Citations come with the text blocks. Planned after phase 1's pipeline mode and eval exist.

## OpenAI-compatible (`openai` 7.23.0): LM Studio and Ollama

- `new OpenAI({ baseURL, apiKey })`; LM Studio `http://host.docker.internal:1234/v1`, Ollama `http://host.docker.internal:11434/v1`. Both accept any non-empty API key; we send a placeholder when none is configured (not a secret).
- JSON mode: `response_format: { type: "json_object" }` (widely supported); `json_schema` support varies by server/model → try `json_schema` first when `<TASK>_LLM_JSON_MODE=schema`, otherwise `json_object` plus the schema in the prompt. Always validate with zod.
- Repair (brief 8): on a zod failure, exactly one retry with the validation errors appended; if that fails → `nicht_pruefbar` with reason `invalid_llm_output`.
- Containers reach the Mac via `host.docker.internal`; this needs the workers on the `egress` network (the `internal` network blocks the host).

## Mock

Deterministic responses keyed by a normalised prompt hash, loaded from fixtures in the test or the eval; unknown prompts return a fixed `nicht_pruefbar`. Used in CI for every stage; no network.
