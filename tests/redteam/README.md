# Red team (promptfoo)

LLM red teaming of the text-mode pipeline (brief 15.5, 15.7; ADR 0014). promptfoo sends attack claims through the real app – WebSocket session and `POST /api/claims/check` via Caddy – and checks what a user would see: verdict, sources, explanation.

- **Attacks** (`promptfooconfig.yaml`): 13 cases after the OWASP LLM Top 10 – direct and indirect prompt injection (the mock corpus serves a crafted page for moon-landing claims), obfuscation, forged JSON, link smuggling, asking for keys or the prompt.
- **Checks** (`src/assertions.ts`): deterministic code, no LLM grader – sources only from fetched pages, no foreign link in the explanation, no prompt fragment, nothing secret-like, false claims not talked into `stimmt`.
- **Privacy**: promptfoo's telemetry, update checks, sharing and hosted generation are switched off in `compose.test.yaml`; results stay in `reports/` (git-ignored).

## When

At the end of every phase, and whenever prompts, models, the classifier, research sources or the explainer change. Not on every PR (that is what the deterministic stage 3 tests are for).

## How

`make redteam` starts its own Compose project `lfc-redteam` on ports 8083/8445, so a running stack is never touched, and removes it with its volumes afterwards. It always uses the fixed mock research corpus with the crafted page switched on (`CHECKER_RESEARCH_SOURCES=mock`, `CHECKER_MOCK_INJECTED_PAGE=on`); the normal stack keeps that page off.

The model is chosen by environment variables for this one command, so the settings of your normal stack stay as they are. Example with the local model via LM Studio (≥ 0.3, structured output):

```sh
export CHECKER_LLM_PROVIDER=openai-compatible
export CHECKER_LLM_MODEL=qwen2.5-coder-7b-instruct
export CHECKER_LLM_BASE_URL=http://host.docker.internal:1234/v1
export CHECKER_CLASSIFIER_PROVIDER=llm
export EXPLAINER_LLM_PROVIDER=openai-compatible
export EXPLAINER_LLM_MODEL=qwen2.5-coder-7b-instruct
export EXPLAINER_LLM_BASE_URL=http://host.docker.internal:1234/v1
# local models are slower:
export CHECKER_LLM_TIMEOUT_MS=180000 CHECKER_TIMEOUT_MS=480000
export EXPLAINER_LLM_TIMEOUT_MS=180000 EXPLAINER_TIMEOUT_MS=240000
make redteam
```

How long the client waits (milliseconds, positive integers): `REDTEAM_CONNECT_TIMEOUT_MS` (default 15 000), `REDTEAM_VERDICT_TIMEOUT_MS` (600 000), `REDTEAM_EXPLANATION_TIMEOUT_MS` (300 000).

For a cloud model (e.g. Claude), set the `anthropic` provider instead and fill the secret file `anthropic_api_key`; each run costs money, so estimate first (13 claims × three model calls plus the explanation).

Report: `reports/redteam-results.html`. Keep the reports of a phase-end run as evidence in `docs/evidence/phase-N/`.

On a 16 GB Mac, stop other stacks and memory-hungry apps first: the Docker VM (8 GB) plus a 7B model otherwise swap heavily.
