# 0014: Security scanning stack (SonarQube, DAST, LLM red teaming, LLM code scan)

- Status: accepted (part of the phase 1b plan approved by Marco on 2026-09-27)
- Date: 2026-09-27

## Context

Phase 0 and 1 already run ESLint strict, Semgrep, CodeQL, Trivy, gitleaks, dependency-cruiser, a coverage gate and Stryker, plus `reviewer`/`security-reviewer` on every PR. The phase 1 review found two blockers (a gateway-auth bypass via percent-encoded paths, an unbounded stream retry loop) that none of the automated tools caught — only an agent review did. Marco asked for two additional kinds of tooling: static analysis with SonarQube ("Sonar Cube"), and an LLM-based security scan/attack with a local model (Qwen or DeepSeek). Phase 1b adds only what finds or shows something the existing pipeline does not; it does not duplicate it.

## Decision

- **SonarQube Cloud** (not self-hosted): free for public repos, gives a Quality Gate on new code, code smells, duplication, cognitive complexity, security hotspots and a coverage trend — the class of finding the phase-1 review made by hand (e.g. the 280-line `checkClaim`). Runs as a CI job in `ci.yml` after the test jobs (needs the coverage artifacts); beratend (non-blocking) for the first week to establish a baseline, then a required check `sonar passed` alongside `ci passed`/`pr passed`.
- **SonarQube for IDE** (formerly SonarLint) in Connected Mode against the Cloud project, for both Claude Code's and Antigravity's editor (both VS Code-based).
- **SonarQube MCP server** (official image, pinned by digest) in both `.mcp.json` and `.agents/mcp_config.json`, so both agent tools can read open findings before opening a PR.
- **OWASP ZAP Baseline** as DAST against the running test stack (`compose.test.yaml`), a step in `stack-tests.yml` after stage 4. Finds things static analysis cannot: response headers, cookie flags, information leaks on live responses. A rules file documents accepted exceptions with a reason.
- **promptfoo red team** against the real pipeline (`POST /api/claims/check` + WebSocket, isolated stack, mock providers by default): prompt injection via crafted sources, attempts to shift the verdict, foreign links in explanations, attempts to extract the system prompt or a key — the OWASP LLM Top 10 applied to this app. The attacker model is a local model (Qwen3-Coder or DeepSeek-Coder) served by LM Studio, reached the same way the `openai-compatible` provider reaches local models (`host.docker.internal`). Run via `make redteam`, not in CI (GitHub runners cannot load local models); the deterministic injection cases are additionally captured as ordinary stage-3 tests so they run on every PR.
- **Local LLM code scanner** (Qwen3-Coder / DeepSeek-Coder via LM Studio) as a second opinion on the diff, SARIF output, uploadable to GitHub code scanning on request. Never a blocking check: local LLM output is not deterministic and produces false positives at a rate that would make it noisy as a gate.
- Agents must never dismiss a security finding themselves (as false positive, safe or won't-fix) or disable a rule; every `nosemgrep`/suppression needs a written reason in the code and is named in the PR, for the owner to accept.
- **Not adopted:** self-hosted SonarQube Community Build (needs Postgres, 2-4 GB RAM, and does not analyse PRs/branches — a candidate for the phase 5 Kubernetes demo instead, not for the CI gate); DeepSeek/Qwen cloud APIs (code and prompts would leave the EU to a third party; local via LM Studio/Ollama is enough).

## Alternatives

- **Self-hosted SonarQube from day one:** rejected for now — the Cloud tier is free at this scale and needs no extra infrastructure; self-hosting becomes interesting once Kubernetes exists to run it on (phase 5).
- **LLM code scan as a blocking check:** rejected — false positives would train everyone to ignore it, defeating the purpose (same reasoning as for the LLM classifier's confidence thresholds).
- **DAST in every PR:** rejected for now — ZAP's baseline scan adds real time to the PR pipeline; it runs in `stack-tests.yml` where stage 4 already spins up the stack, so the marginal cost is one more step, not a new environment.

## Consequences

- Two more accounts/credentials to manage: SonarQube Cloud (`SONAR_TOKEN` as a GitHub secret) and a locally running LM Studio server for red teaming and the code scanner. Both need Marco's one-time setup; the plan lists exactly when Claude reminds him (`.ai/plans/phase-1b-security-tooling.md`).
- CI grows by one more job (`sonar`) and, in `nightly`/`stack-tests`, one more step (ZAP). Red teaming and the LLM code scan stay local/manual to avoid needing GPU-capable runners.
- If SonarQube Cloud's Quality Gate turns out too noisy on this codebase's style, the plan is to tune the gate's ruleset before making it a required check, not to skip the trial period.
