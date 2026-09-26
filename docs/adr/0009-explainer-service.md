# 0009: `explainer` as its own service

- Status: accepted
- Date: 2026-09-26

## Context

In phase 0 the verdict and its explanation were one LLM call in the `fact-checker` and one event (`ClaimChecked.explanation`). With a classifier deciding the verdict (ADR 0007), the verdict is available long before any text is generated, and Jev cannot generate text at all. Brief 5, 6a and 9.6 want the verdict shown first and the explanation added when it arrives.

## Decision

- New worker `services/explainer`: consumes `claims.checked` (consumer group `explainer`), renders `services/explainer/prompts/explanation.md` with the claim, the verdict and the evidence snippets (delimited as data), asks `EXPLAINER_LLM_*` for at most two German sentences, validates against `ClaimExplained` (sentence and length limits from the contract), publishes to `claims.explained` and the session channel.
- The `fact-checker` publishes `claims.checked` without waiting for the explainer.
- `nicht_pruefbar` verdicts get an explanation too (why no verdict), cache hits reuse nothing: the explanation is regenerated per claim, since it is cheap and not cached in phase 1.
- On failure (LLM error, invalid output after one repair attempt, budget exceeded) no event is sent; the card keeps its placeholder and a metric `explanations_failed_total{reason}` counts it.
- Secrets: only the LLM key (`EXPLAINER_LLM_API_KEY`); no Jev key, no search keys (brief 15.1). Networks: `internal` + `egress` (cloud LLM or LM Studio/Ollama on the host).
- Scales independently; in Kubernetes (phase 5) a KEDA ScaledObject may take it to zero.

## Alternatives

- **Explanation inside the fact-checker, published as a second event:** fewer containers, but couples scaling and failure of the slow generative step to the verdict path and gives the fact-checker a text-generation role.
- **Explanation generated in the browser request path (gateway):** blocks the API and puts LLM keys into the edge service.

## Consequences

- `ClaimChecked` v2 drops `explanation`; `ClaimExplained` v1 is new (ADR 0010).
- The UI must handle "verdict without explanation yet" and "explanation never arrives" (placeholder stays, no spinner forever: after 30 s it switches to "keine Erklärung verfügbar").
- One more image to build, scan and deploy.
