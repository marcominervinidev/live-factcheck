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
- If the same correction happens twice, propose adding the rule to the right `AGENTS.md`, skill or review prompt. Do not use personal agent memory for project rules.

## Code conventions

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

- Never read, print or write `.env` files or anything in the secrets directory (`SECRETS_DIR`, default `~/.config/live-factcheck/secrets`). Do not run commands that touch it.
- Secrets never go into code, commits, images, build args, the frontend, `/config.json`, logs, errors, metrics or traces.
- `.env.example` holds only non-secret settings.

## Architecture overview

Mobile-first PWA (`apps/web`) → `gateway` (only public API, REST + WebSocket) → `transcription` (STT adapters) → Redis Streams `transcript.segments` → `claim-extractor` → `claims.detected` → `fact-checker` (web research + LLM) → `claims.checked`. Client events go via Redis Pub/Sub `session:{sessionId}:events` back through the gateway. `caddy` terminates TLS and is the only container with host ports. Details: brief sections 5–7.
