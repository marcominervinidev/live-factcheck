---
name: evidence
description: "Collect the proof that a task is done (brief 1.3) in the fixed format under docs/evidence/phase-N/: real command output, HTTP requests and responses, Redis state, screenshots. Use before marking any task or gate as done."
---

# Collect evidence for a task

Claims like "done" or "tests are green" are not evidence. Every finished task leaves artifacts.

## File naming

`docs/evidence/phase-<N>/<task-id>-<short-slug>.<txt|md|png>`, e.g. `t2.4-contract-check-scenarios.txt`, `gate-2-ci.md`.

## Format of a text artifact

```
$ <exact command>   # one-line comment: what situation this shows
<real output>
exit code: <n>
```

- Capture real output; never retype or shorten it by hand. Strip ANSI colour codes (`sed -E 's/\x1b\[[0-9;]*m//g'`).
- Replace machine-specific paths with `<repo>` or `<tmp>`.
- Include skipped tests and why they were skipped.
- Negative tests (something must fail) show the failing output and the non-zero exit code.

## What to capture per area

| Area | Evidence |
|---|---|
| Tests and checks | output of test, lint and scan commands |
| Backend | real HTTP request and response against the running stack; Redis state via the Redis MCP or `redis-cli` (stream entries, consumer groups, pending entries) |
| Frontend | Playwright run of the user flow, screenshots at decision points, console errors |
| Cross-service | stream entries plus log excerpts of all involved containers (`docker compose logs <svc>`) |
| Infrastructure (phase 5+) | `kubectl` output, Argo CD sync status, Grafana screenshots |
| CI | links to the run, `gh pr checks` output |

## Never

- Never include secrets, tokens, `.env` contents or anything from the secrets directory. Grep the artifact for known secret patterns before committing; the pre-commit gitleaks hook is the second line of defence.
- Never include transcript content from real conversations.

## Finally

Reference the artifacts in the PR description (table: what – where) and in the `## Status` section of the plan file.
