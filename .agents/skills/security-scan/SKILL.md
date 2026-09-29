---
name: security-scan
description: "Which security scan to run when (SonarQube, Semgrep/CodeQL, OWASP ZAP, promptfoo red team, local LLM code scan) and how to handle its findings (brief 15.7, ADR 0014). Use before opening a PR that touches security-relevant code, at the end of every phase, and whenever a scanner reports something."
---

# Security scans

The scanners complement the reviews (`reviewer`, `security-reviewer`); none replaces them. Decision and scope: ADR 0014, brief 15.7.

## Which scan, when

| Scan | Runs | Gate? | You do |
|---|---|---|---|
| Semgrep, CodeQL, Trivy, gitleaks | every PR (CI) | yes | fix what they report; see "Handling findings" |
| SonarQube Cloud | every push (CI job `sonarqube`) | advisory during the baseline week, then yes | before a PR ask the SonarQube MCP server (read-only) for new issues and hotspots on the branch |
| OWASP ZAP baseline | every PR (stack tests) | rules marked FAIL in `tests/security/zap-rules.tsv` | locally `make zap`; a new header or cookie finding is fixed in Caddy, not ignored |
| promptfoo red team | end of every phase; after changes to prompts, models, classifier, research sources or the explainer | no (evidence) | `make redteam` with a real model (`tests/redteam/README.md`); keep the report in `docs/evidence/phase-N/` |
| local LLM code scan | on demand | never | `make llm-scan`; treat the result as a prompt for a second look, most findings are noise |

Semgrep in CI blocks on every severity, and it is not part of the pre-commit hook. After adding code that parses input, builds URLs, runs commands or handles tokens, run it locally with the CI rule sets before pushing:

```sh
docker run --rm -v "$PWD":/src:ro -w /src semgrep/semgrep:1.178.0 semgrep scan --error --metrics=off \
  --config p/typescript --config p/nodejsscan --config p/dockerfile --config p/github-actions --config p/secrets
```

Keep the image version equal to the one in `.github/workflows/pr.yml`, or local and CI results differ.

## Handling findings

1. **Reproduce or reason it through.** Point to the line and the input that would exploit it. A finding you cannot explain is not yet understood, not yet a false positive.
2. **Fix the cause**, with a test on the lowest stage where it shows (AGENTS.md). Regressions of real findings become fixed test cases (e.g. the encoded-path bypass in `tests/api/edge.spec.ts`).
3. **A genuine false positive** is suppressed as narrowly as possible, with the reason in the code: `// nosemgrep: <rule-id> -- <why>` on the flagged line or the line above it. Name every suppression in the PR description.
4. **Never** dismiss an alert in GitHub code scanning or SonarQube, mark it *won't fix*, *false positive* or *safe*, change a rule level (`zap-rules.tsv`, quality gate) or disable a rule. That decision is the owner's. The SonarQube MCP server runs read-only for this reason.
5. Findings about secrets (a key in code, logs or a response) are always fixed first; if a real key was exposed, follow "If a key leaks" in `docs/SECURITY.md` and tell the owner at once.

## Red team results

- A failing check is a finding: record it in the evidence file with the attack text, the output and the model used, and propose a mitigation in the PR. Do not weaken the check to make it pass.
- Results depend on the model behind the pipeline. Name it in every report; compare a weak local model with a strong one before concluding that an attack works in production.
- promptfoo's telemetry, sharing and hosted generation stay off (`compose.test.yaml`).
