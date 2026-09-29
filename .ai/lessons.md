# Lessons (first occurrences)

Agent mistakes and owner corrections, noted the first time they happen (rule in `AGENTS.md`, Workflow). A lesson becomes a rule only on its **second** occurrence and only if no tool catches it already; prefer an automated check over a written rule. When promoting, name the file and date in "Status".

| Date | Mistake | Caught automatically? | Status |
|---|---|---|---|
| 2026-09-29 | Judged `pnpm typecheck` green by grepping its output for `error TS`; `tsc --pretty` colours the output, so the errors were missed. | CI (later), not locally | first occurrence – candidate rule: judge checks by exit code, never by filtered output |
| 2026-09-29 | Committed the TP3 service on the TP2 branch (noticed before the push). | partly: the commit helper now prints the branch | first occurrence |
| 2026-09-29 | `stt-local` passed all tests but could not serve WebSockets in the container (uvicorn needs `websockets`; Starlette's test client does not). | no | first occurrence – candidate rule: start a new service once for real (process or container) and talk to it, not only through the test client |
| 2026-09-29 | Fake API keys with digit runs in tests triggered gitleaks. | yes (gitleaks, pre-commit) | no rule needed |
