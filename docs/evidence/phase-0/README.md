# Phase 0 evidence

Every claim of phase 0 maps to an artifact here, a test in the repo or a CI run (brief 1.3). Local runs used throwaway secrets and, from TP6 on, an isolated Compose project (`lfc-verify`), never the owner's stack or secrets.

## Definition of Done (brief 17, phase 0)

| # | DoD item | Evidence | State |
|---|---|---|---|
| 1 | `make up` starts everything, `https://localhost` shows the empty app, all `/readyz` green | [t5-stack-up.txt](t5-stack-up.txt) (`make up`, `make ready`); stage 4 smoke test through Caddy in 4 browsers: [t6-stage3-4.txt](t6-stage3-4.txt) | done |
| 2 | No container except Caddy publishes a host port | [t5-stack-up.txt](t5-stack-up.txt) (`make check-ports`) | done |
| 3 | `make scan` reports no critical findings | [t5-scan.txt](t5-scan.txt); in CI per image in `pr.yml` (Trivy) | done |
| 4 | A service without required config exits with a clear message | `services/*/src/main.test.ts`, `packages/service-kit/src/lifecycle.test.ts`; images: [t4-images.txt](t4-images.txt) | done |
| 5 | A configured API key appears in no log line | `services/fact-checker/src/main.test.ts` (test marked "(DoD)"), `packages/service-kit/src/logger.test.ts` (7 leak paths), `lifecycle.test.ts` | done |
| 6 | The first PR is green in CI and the README shows the status badge | [gate-2-ci.md](gate-2-ci.md); badges at the top of the [README](../../../README.md) | done |
| 7 | Pre-commit < 30 s; push pipeline runs backend and frontend jobs in parallel | [t5-precommit-timing.txt](t5-precommit-timing.txt) (11.1 s incl. unit tests); job timeline in [gate-2-ci.md](gate-2-ci.md) and the `ci.yml` runs of PR #6 (backend and frontend matrices start together) | done |
| 8 | No secret in the repo; services read secrets from `SECRETS_DIR` | gitleaks over the full history in every `ci.yml` run; [t5-security.txt](t5-security.txt): only `*_FILE` paths in container environments, no plain-text password in Redis' ACL file | done |
| 9 | An Antigravity session names the next task from `AGENTS.md` and the plan without questions | T7.4, needs the owner's Antigravity session | **open** |

## By task

| Task | Artifact |
|---|---|
| T1.3 boundaries | [t1.3-depcruise-negative.txt](t1.3-depcruise-negative.txt) – a service-to-service import is rejected |
| T1.5 secrets outside the repo | [t1.5-secrets-init.txt](t1.5-secrets-init.txt) – permissions, idempotence, refusal inside the repo |
| T1.6 pre-commit | [t1.6-precommit-leak-blocked.txt](t1.6-precommit-leak-blocked.txt) – a dummy Anthropic key blocks the commit |
| Gate 1 | [gate-1-make-lint.txt](gate-1-make-lint.txt) |
| T2.1 lint rules | [t2.1-eslint-negative.txt](t2.1-eslint-negative.txt) – `any`, bare `@ts-ignore`, undescribed disables rejected |
| T2.3 hook timing | [t2.3-precommit-timing.txt](t2.3-precommit-timing.txt) |
| T2.4 contract guard | [t2.4-contract-check-scenarios.txt](t2.4-contract-check-scenarios.txt) – 6 scenarios; regression test `scripts/ci/contract-check-scenarios.sh` |
| Gate 2 CI | [gate-2-ci.md](gate-2-ci.md) |
| T3.4 agent hooks | [t3.4-hooks.txt](t3.4-hooks.txt) – 21 cases; regression test `.claude/hooks/test-hooks.sh` |
| TP4 images | [t4-images.txt](t4-images.txt) – users, sizes, hadolint, fail-fast, read-only code, no shell |
| TP5 stack | [t5-stack-up.txt](t5-stack-up.txt), [t5-security.txt](t5-security.txt) (Redis ACL, env, hardening, network segmentation, headers), [t5-scan.txt](t5-scan.txt), [t5-precommit-timing.txt](t5-precommit-timing.txt) |
| TP6 stages 3–5 | [t6-stage3-4.txt](t6-stage3-4.txt), [t6-stage5.txt](t6-stage5.txt) (Lighthouse 100/100/100; Stryker set up, score not yet trustworthy) |

## Known gaps

- DoD 9 (Antigravity) is open until the owner's first Antigravity session.
- `main.yml` and `nightly.yml` have only been validated with actionlint; their first real runs happen after the merge to `main`.
- The Stryker score is reported but not trustworthy yet (see [t6-stage5.txt](t6-stage5.txt)).
