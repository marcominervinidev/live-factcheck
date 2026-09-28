# Local LLM security scan

A second opinion on the security of a change (brief 15.7, ADR 0014): a local language model reviews the diff against `main` in small, line-numbered excerpts and reports concrete weaknesses as SARIF. **Advisory only** – a local model is not deterministic and produces false positives, so this is never a merge gate. SonarQube, Semgrep, CodeQL and the reviews remain the real checks.

- Only new lines of production code and config are reviewed (tests, docs, lockfiles and generated files are skipped); findings that point outside the new lines are dropped as guesses.
- The code is passed as delimited data, so comments in the code cannot redirect the model.
- Only a local model may read the code: the scan refuses to start with a cloud provider or a non-local `SCAN_LLM_BASE_URL`.
- The model is reached through the same adapter as the pipeline (`@lfc/providers`, task `SCAN`): structured output, schema validation, one repair attempt.

## Run

LM Studio (≥ 0.3) with the model loaded and the server on `localhost:1234`, then:

```sh
make llm-scan                      # against origin/main
make llm-scan LLM_SCAN_BASE_REF=origin/some-branch
```

Settings (defaults in the Makefile): `SCAN_LLM_MODEL`, `SCAN_LLM_BASE_URL`, `SCAN_LLM_TIMEOUT_MS`, `LLM_SCAN_MAX_CHARS` (chunk size, 500–40 000).

Output: `scripts/llm-scan/reports/llm-scan.md` (summary) and `llm-scan.sarif`.

## Upload to GitHub code scanning (optional)

Only if you want the findings next to CodeQL's in the Security tab, as category `llm-scan`:

```sh
gzip -c scripts/llm-scan/reports/llm-scan.sarif | base64 | tr -d '\n' > /tmp/llm-scan.b64
gh api repos/marcominervinidev/live-factcheck/code-scanning/sarifs \
  -f commit_sha="$(git rev-parse HEAD)" -f ref="refs/heads/$(git branch --show-current)" \
  -F sarif=@/tmp/llm-scan.b64 -f tool_name=llm-scan
```

Findings there are the owner's to triage; agents never dismiss them (AGENTS.md).
