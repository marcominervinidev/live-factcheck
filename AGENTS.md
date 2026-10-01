# AGENTS.md – live-factcheck

Authoritative rules for every coding agent (Claude Code, Antigravity, others) and for humans.
Scope: the whole repo. Service and package folders have their own `AGENTS.md` with rules that apply only there; the narrowest scope wins.

Source of truth for goals and architecture: `docs/PROJECT_BRIEF.md`. Current work: the phase plan in `.ai/plans/`. Agent tooling for Claude Code and Antigravity: `docs/ai-tooling.md`.

Tool-neutral sources: role prompts in `.ai/prompts/`, skills in `.agents/skills/`, MCP servers in `.mcp.json` and `.agents/mcp_config.json` (kept identical, checked in CI). Every package or service with its own `AGENTS.md` also gets a glob rule in `.agents/rules/` so Antigravity loads it.

## Stack

- pnpm workspaces monorepo: `apps/*`, `services/*`, `packages/*`, `tests/*`
- Node 24 LTS, TypeScript 6.0 (strict, ESM/NodeNext, project references), ESLint 10 + typescript-eslint, Prettier, dependency-cruiser, Vitest, Playwright
- Backend: Fastify, pino, zod, ioredis. Frontend: React, Vite, Tailwind, Zustand, nginx
- `stt-local`: Python (own `AGENTS.md`)
- Runtime: Docker Compose, later k3d/k3s with Argo CD

## Commands

The host has only Docker and Git. Node tooling runs in the toolbox container.

- `scripts/tb <cmd>` runs a command in the toolbox (starts it if needed), e.g. `scripts/tb pnpm lint`
- `make help` lists all targets; `make lint` runs stage 0 (typecheck, lint, format check, boundaries)
- `make toolbox` rebuilds/starts the toolbox, `make install` installs deps with the frozen lockfile
- `make hooks-install` installs the git pre-commit shim (lefthook in the toolbox)
- Stack: `make up` (production images, waits until healthy), `make ready`, `make check-ports`, `make logs`, `make down`; `make dev` for hot reload via `docker compose watch`
- Tests: `make test-unit`, `make test-integration` (2a + 2b), `make test-api`, `make test-e2e`, `make test` (stages 0–4); `make scan` (Trivy on all local images)
- Diagnose containers with `docker compose ps|logs|exec` (runtime images have no shell; use `scripts/ready.sh` patterns with a throwaway curl container). There is no Docker MCP server by design.
- To verify the stack yourself, never touch the owner's stack: use an isolated Compose project on other host ports and a throwaway secrets directory, e.g. `COMPOSE_PROJECT_NAME=lfc-verify LFC_HTTP_PORT=8082 LFC_HTTPS_PORT=8444 SECRETS_DIR=<tmp>`. Tear it down with `down -v` afterwards. The owner's project `live-factcheck` may be running at any time.
- After changing a secret file, running containers keep the old value: recreate them with `docker compose up -d --force-recreate`.
- Never install Node, pnpm or Python packages on the host.

## Workflow

- Work only in the phases of the brief (section 17) and along the approved plan `.ai/plans/phase-N-<title>.md`.
- Stop at every review gate in the plan. Do not start the next task block without approval.
- Never commit to `main` and never merge. One feature branch per phase or subproject; small Conventional Commits.
- Keep the plan file current enough that a fresh session in any tool can continue without questions: tick finished tasks, name the next task, note open points in `## Status`.
- Switch tools only at a review gate. Before switching, update the plan and commit work in progress (`wip:` prefix allowed).
- Every non-trivial architecture decision gets an ADR in `docs/adr/NNNN-title.md` (template `0000-template.md`).
- A task is done only with evidence (brief 1.3): real command output, requests/responses, screenshots. Store it compactly in `docs/evidence/phase-N/`.
- Scripts that change git state (checkout, reset, commit, branch) run only in a throwaway clone, start with `set -euo pipefail` and verify their working directory before the first write. Never run such experiments against the real working tree.
- Every commit, merge commits and `wip:` commits included, runs the pre-commit hook; never bypass it (`core.hooksPath`, `--no-verify`). If the hook blocks unfinished work, park it with `git stash` or fix the finding.
- Pull requests are sized for the owner's review (owner decision 2026-09-30):
  - One task of the plan per PR (e.g. T6.2), at most about 400 changed lines of production code; tests, evidence and lockfiles do not count. Split larger tasks.
  - Commits tell the story in review order (contract → logic → wiring → tests → docs), so the owner can review commit by commit.
  - At most one PR stacked on another open PR; its description names the merge order. The moment the base PR is merged, retarget the stacked PR to `main` (`gh pr edit <n> --base main`) before anyone merges it - merging it into the stale base stranded #39 and #48 (promoted lesson 2026-10-01).
  - The description follows `.github/pull_request_template.md`: first the German review guide for the owner (what and why, where to look with the risk, what to skip, decisions, how it was verified, and the table "Belegt durch" mapping every requirement of the PR to its proving test and stage, like the plan's "DoD → Tests"), then the technical details in English.
  - A Mermaid diagram (rendered by GitHub) only when a flow or the architecture changes, never as decoration.
  - No third-party review bots; the scanners in `docs/SECURITY.md` and the prompts in `.ai/prompts/` do the automated review.
- Learning from mistakes: note the first occurrence of an agent mistake (or a correction by the owner) in `.ai/lessons.md`. A rule is written only when the same mistake happens **a second time** and no tool (hook, lint, CI, gitleaks, contract check) already catches it. Prefer turning it into an automated check; otherwise add the rule to the narrowest `AGENTS.md`, skill or review prompt and mark the lesson as promoted. Do not use personal agent memory for project rules.

## Code conventions

- **Every message to the owner is in German** (owner decision 2026-09-30, after several corrections): chat replies, short status lines between tool calls, questions, summaries and the review guide at the top of a PR. Use German words where they exist (Stufe, Zweig, Prüfung). Only artefacts in the repository stay English: code, identifiers, comments, commit messages and the technical part of PR descriptions.
- Code, identifiers and comments in English. UI texts in German, stored i18n-ready (never inline in components).
- TypeScript strict. `any` and `@ts-ignore` are forbidden; an exception needs an ESLint disable or `@ts-expect-error` with a written reason.
- Configuration only via environment variables, validated with zod at startup (fail fast). Secrets also via `<NAME>_FILE`.
- No shortcuts to make a test pass: never make required fields optional, widen types or hide errors behind silent defaults. If a type or boundary blocks you, stop and report it.
- No overbuild: no abstractions, flags or features that are not in the brief or the approved plan. Put ideas into the PR as suggestions.
- New services copy the structure of the best existing service (skill `new-service`).

## Module boundaries and contracts

- `packages/contracts` is read-only for agents. If a contract does not fit, stop and propose the change. An approved change needs its own commit with an ADR, a higher `schemaVersion` and updated contract tests. CI rejects contract changes without these.
- Services never import each other. Imports across workspaces only from `packages/*` through their declared `exports`. Enforced by dependency-cruiser (`pnpm depcruise`).

## Tests

- Test pyramid and stages as in brief 13. New logic comes with unit tests in the same commit.
- Reproduce a bug first with a test on the lowest stage where it shows.
- Mocks only at system boundaries (LLM, STT, web search; the backend in frontend tests). Test behaviour, not the mock.
- Deterministic and isolated: no real API keys, no external network, fake timers, own `sessionId` and key prefixes per test.

## Security

Threat model, secret handling and key rotation: `docs/SECURITY.md`.

- Never read, print or write `.env` files or anything in the secrets directory (`SECRETS_DIR`, default `~/.config/live-factcheck/secrets`). Do not run commands that touch it.
- Secrets never go into code, commits, images, build args, the frontend, `/config.json`, logs, errors, metrics or traces.
- `.env.example` holds only non-secret settings.
- Never dismiss a security finding yourself (SonarQube, Semgrep, CodeQL, ZAP, LLM scan or review) as *won't fix*, *false positive* or *safe*, and never disable a rule. Fix the finding, or if it is a genuine false positive, suppress it narrowly (e.g. `nosemgrep`) with a written reason in the code, and name it in the PR — the owner decides, not the agent (brief 15.7, ADR 0014).

## Architecture overview

Mobile-first PWA (`apps/web`) → `gateway` (only public API, REST + WebSocket) → `transcription` (STT adapters) → Redis Streams `transcript.segments` → `claim-extractor` → `claims.detected` → `fact-checker` (web research + LLM) → `claims.checked`. Client events go via Redis Pub/Sub `session:{sessionId}:events` back through the gateway. `caddy` terminates TLS and is the only container with host ports. Details: brief sections 5–7.
