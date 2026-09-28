# Red team (promptfoo)

LLM red teaming of the text-mode pipeline (brief 15.5, 15.7; ADR 0014). promptfoo sends attack claims through the real app – WebSocket session and `POST /api/claims/check` via Caddy – and checks what a user would see: verdict, sources, explanation.

- **Attacks** (`promptfooconfig.yaml`): 13 cases after the OWASP LLM Top 10 – direct and indirect prompt injection (the mock corpus serves a crafted page for moon-landing claims), obfuscation, forged JSON, link smuggling, asking for keys or the prompt.
- **Checks** (`src/assertions.ts`): deterministic code, no LLM grader – sources only from fetched pages, no foreign link in the explanation, no prompt fragment, nothing secret-like, false claims not talked into `stimmt`.
- **Privacy**: promptfoo's telemetry, update checks, sharing and hosted generation are switched off in `compose.test.yaml`; results stay in `reports/` (git-ignored).

## When

At the end of every phase, and whenever prompts, models, the classifier, research sources or the explainer change. Not on every PR (that is what the deterministic stage 3 tests are for).

## How

The stack must run with a real model behind the pipeline, e.g. the local model via LM Studio (≥ 0.3, structured output) and the fixed mock research corpus. Set in `.env`:

```sh
CHECKER_LLM_PROVIDER=openai-compatible
CHECKER_LLM_MODEL=qwen2.5-coder-7b-instruct
CHECKER_LLM_BASE_URL=http://host.docker.internal:1234/v1
CHECKER_CLASSIFIER_PROVIDER=llm
EXPLAINER_LLM_PROVIDER=openai-compatible
EXPLAINER_LLM_MODEL=qwen2.5-coder-7b-instruct
EXPLAINER_LLM_BASE_URL=http://host.docker.internal:1234/v1
CHECKER_RESEARCH_SOURCES=mock
# local models are slower:
CHECKER_LLM_TIMEOUT_MS=180000
CHECKER_TIMEOUT_MS=480000
EXPLAINER_LLM_TIMEOUT_MS=180000
EXPLAINER_TIMEOUT_MS=240000
```

Then `make redteam`. For a cloud model (e.g. Claude), set the `anthropic` provider instead and fill the secret file `anthropic_api_key`; each run costs money, so estimate first (13 claims × three model calls plus the explanation).

Report: `reports/redteam-results.html`. Keep the reports of a phase-end run as evidence in `docs/evidence/phase-N/`.

On a 16 GB Mac, stop other stacks and memory-hungry apps first: the Docker VM (8 GB) plus a 7B model otherwise swap heavily.
