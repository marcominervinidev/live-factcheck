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
- Tests: `make test-unit`, `make test-integration` (2a + 2b), `make test-api`, `make test-e2e`, `make test` (stages 0–4); `make scan` (Trivy on the `:local` images of `make up`; `SCAN_TAG=test` for those of the last test run). `make test-api`, `make test-e2e` and `make zap` run through `scripts/stack-test.sh`: their own mock stack with throwaway secrets (Compose project `lfc-test`, settings only from `.env.example`, localhost ports 8084/8446, image tag `test`), removed afterwards. `make eval` and `make redteam` measure the providers configured in `.env`.
- Diagnose containers with `docker compose ps|logs|exec` (runtime images have no shell; use `scripts/ready.sh` patterns with a throwaway curl container). There is no Docker MCP server by design.
- To verify the stack yourself, never touch the owner's stack: use an isolated Compose project on other host ports and a throwaway secrets directory, e.g. `COMPOSE_PROJECT_NAME=lfc-verify LFC_HTTP_PORT=8082 LFC_HTTPS_PORT=8444 SECRETS_DIR=<tmp>`. Tear it down with `down -v` afterwards. The owner's project `live-factcheck` may be running at any time.
- After changing a secret file, running containers keep the old value: recreate them with `docker compose up -d --force-recreate <services>`, naming the services that mount it. Without names it also recreates Redis, which has no data volume: the streams, the session memory and the day's budget counter are gone.
- Never install Node, pnpm or Python packages on the host.

## Workflow

- Work only in the phases of the brief (section 17) and along the approved plan `.ai/plans/phase-N-<title>.md`.
- Stop at every review gate in the plan. Do not start the next task block without approval.
- Never commit to `main` and never merge. One feature branch per phase or subproject; small Conventional Commits.
- Keep the plan file current enough that a fresh session in any tool can continue without questions: tick finished tasks, name the next task, note open points of the running task block in `## Status`; durable owner items and backlog move to GitHub issues instead (see below).
- Every task in a plan gets a risk level when the plan is written (low/medium/high, derived like the PR merge-danger block from revertibility and blast radius). High-risk tasks are implemented and reviewed with the strongest available model; low-risk tasks may use a faster one (owner decision 2026-09-30).
- Every task also names its session type (owner 2026-09-30, after the Wayfinder comparison): research, prototype, clarify (bundled questions for the owner) or implement. UI work and foggy concepts get a throwaway prototype task with variants first, and the owner picks the variant - never the agent. The plan's `## Status` keeps a short frontier: what is workable now, and what blocks the rest.
- A new plan, every clarify task and a plan change from an owner idea that leaves a decision open start with the skill `grilling` (owner 2026-10-01).
- The plan file stays the tool-neutral source of truth. GitHub issues hold only the backlog and the owner's open items (labels `backlog`, `erinnerung`); finished plan phases move their leftovers there instead of growing the status. What the next project should adopt from day one goes to `docs/NEXT_PROJECT.md`, fed by the retro.
- At every review gate, run the skill `retro` over the merged PRs and sessions since the last gate. Its suggestions go to the owner; accepted ones are implemented before the next task block and marked as promoted in `.ai/lessons.md`.
- At every milestone - every review gate of the plan and every block of PRs reported ready to merge - that changes behaviour the owner can run or see, hand the owner a German test guide as a private HTML artifact (owner 2026-10-02; template: the artifact "Testlauf Erkennung"): merge order, the commands that bring the owner's local stack to the new state, what to check in the app, test inputs with the expected result, the counters or log lines to read before and after, the comparison with the last test, costs, and what to send back. The guide hands the commands over; the agent never runs them against the owner's stack.
- Parallel work (owner 2026-09-30, reinforced 2026-10-01): background subagents are the **default**, not the exception, for read-only work (exploration, research, reading logs) and for the reviewer and security-reviewer running side by side on a finished diff while the main session builds on. Prefer spawning one over doing sequential read-only legwork yourself. Never let two agents edit, commit or switch branches in the same working tree, and never run two heavy test or measurement loads at once - both collisions happened on 2026-09-30 (`.ai/lessons.md`). Parallel implementation or long measurements belong in a throwaway clone or worktree.
- Switch tools only at a review gate. Before switching, update the plan and commit work in progress (`wip:` prefix allowed).
- Every non-trivial architecture decision gets an ADR in `docs/adr/NNNN-title.md` (template `0000-template.md`).
- A task is done only with evidence (brief 1.3): real command output, requests/responses, screenshots. Store it compactly in `docs/evidence/phase-N/`.
- Scripts that change git state (checkout, reset, commit, branch) run only in a throwaway clone, start with `set -euo pipefail` and verify their working directory before the first write. Never run such experiments against the real working tree.
- Every commit, merge commits and `wip:` commits included, runs the pre-commit hook; never bypass it (`core.hooksPath`, `--no-verify`). If the hook blocks unfinished work, park it with `git stash` or fix the finding.
- Pull requests are sized for the owner's review (owner decision 2026-09-30):
  - One task of the plan per PR (e.g. T6.2), at most about 400 changed lines of production code; tests, evidence and lockfiles do not count. Split larger tasks.
  - Commits tell the story in review order (contract → logic → wiring → tests → docs), so the owner can review commit by commit.
  - At most one PR stacked on another open PR; its description names the merge order. The moment the base PR is merged, retarget the stacked PR to `main` (`gh pr edit <n> --base main`) before anyone merges it - merging it into the stale base stranded #39 and #48 (promoted lesson 2026-10-01). The stacked PR opens as a **draft** and leaves draft only after this retarget: a draft cannot be merged, so even a seconds-long window cannot strand it (#73 was merged into its base 36 seconds after the base merged). The mechanical fix stays the repo setting in issue #57.
  - The description follows `.github/pull_request_template.md`: first the German review guide for the owner (what and why, where to look with the risk, what to skip, decisions, how it was verified, and the table "Belegt durch" mapping every requirement of the PR to its proving test and stage, like the plan's "DoD → Tests"), then the technical details in English.
  - The description opens with the merge-danger block from the template: risk (low/medium/high), revertibility (not revertible = contracts or schema, migrations or data loss, secrets/security, CI or branch protection, outward-visible behaviour), blast radius (local / cross-service / system), the value for the phase goal, and the recommended review depth (low risk = skim, medium = the named spots, high = line by line). The reviewer prompt double-checks the self-rating.
  - The guide's "Was und warum" carries a small structure sketch in the show-me style (pseudocode, a component or file tree, such a tree as a diff, or a call chain) instead of prose alone.
  - The PR opens compact (owner 2026-09-30): visible are the merge-danger block, what/why with the sketch, where to look, the skip list, decisions and merge order; everything else ("Belegt durch", images and diagrams, verification, Agent-Bilanz, the English details) sits in collapsed `<details>` blocks with a blank line after `</summary>` so tables and Mermaid render.
  - The guide carries an "Agent-Bilanz" section from `python3 scripts/agent-usage.py --since <branch start>` (owner 2026-09-30): tokens per model, top tools with error share and result size, identical repeats. The retro updates the "Agenten-Bilanz" dashboard artifact at every gate.
  - Every PR additionally gets a visual review guide as a private HTML artifact (owner 2026-09-30 for UI and medium or high risk; for every PR since 2026-10-02), linked right below the merge-danger block: before/after of what the owner will see for frontend work, Mermaid or show-me sketches where flows or backend change – mix as fits. Built with the app's real colour tokens. The PR itself carries the guide's key picture as a table or Mermaid, so it stands alone; one page may cover a block of related PRs, and a small docs PR gets a short page. The page stays out of the repository: GitHub shows HTML files only as source, and the repository is public.
  - A Mermaid diagram (rendered by GitHub) only when a flow or the architecture changes, never as decoration.
  - No third-party review bots; the scanners in `docs/SECURITY.md` and the prompts in `.ai/prompts/` do the automated review.
  - Before opening a PR run `make sast` (the CI-pinned Semgrep); after pushing, read the PR's SonarCloud quality gate and work its findings before reporting the PR ready - three new-code gates failed only after opening in the gate-3→4 block (promoted lesson 2026-10-01).
- Learning from mistakes: note the first occurrence of an agent mistake (or a correction by the owner) in `.ai/lessons.md`. A rule is written only when the same mistake happens **a second time** and no tool (hook, lint, CI, gitleaks, contract check) already catches it. Prefer turning it into an automated check; otherwise add the rule to the narrowest `AGENTS.md`, skill or review prompt and mark the lesson as promoted. Do not use personal agent memory for project rules.

## Code conventions

- Judgement-call quality standards live in `docs/CODING_STANDARDS.md`, enforced by the automated review, not the implementation. Mechanical rules become checks (ESLint, dependency-cruiser, Sonar, CI) instead of prose; the file grows through retros and lessons, never by copying book rules.
- **Every message to the owner is in German** (owner decision 2026-09-30, after several corrections): chat replies, short status lines between tool calls, questions, summaries and the review guide at the top of a PR. Use German words for everyday and process terms (Stufe, Prüfung, Aufnahme, Urteil), but **technical terms named after the stack's own concepts always stay English**: Stream, Commit, Branch, Hook, Cache, TTL, Token, Pull-Request, Blast-Radius, revertibel/revertible. Never invent a translation (owner 2026-10-01, after "Stromlebensdauer" for stream TTL confused the review guide). Only artefacts in the repository stay English: code, identifiers, comments, commit messages and the technical part of PR descriptions.
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
- When the owner has to fill or replace a secret or change `.env`, hand over a one-line terminal command that opens the file in TextEdit, e.g. `open -e ~/.config/live-factcheck/secrets/anthropic_api_key` or `open -e ~/dev/live-factcheck/.env` (owner 2026-10-02). For a key file add the plain-text check `file <path>`, which must not say "Rich Text", then the `--force-recreate` line naming the services that mount the secret (their `secrets:` blocks in `docker-compose.yml`). TextEdit, not VS Code: the Claude extension can pass selected text of open files into the chat. Never run these commands yourself on the owner's stack.
- Secrets never go into code, commits, images, build args, the frontend, `/config.json`, logs, errors, metrics or traces.
- `.env.example` holds only non-secret settings.
- Never dismiss a security finding yourself (SonarQube, Semgrep, CodeQL, ZAP, LLM scan or review) as *won't fix*, *false positive* or *safe*, and never disable a rule. Fix the finding, or if it is a genuine false positive, suppress it narrowly (e.g. `nosemgrep`) with a written reason in the code, and name it in the PR — the owner decides, not the agent (brief 15.7, ADR 0014).

## Architecture overview

Mobile-first PWA (`apps/web`) → `gateway` (only public API, REST + WebSocket) → `transcription` (STT adapters) → Redis Streams `transcript.segments` → `claim-extractor` → `claims.detected` → `fact-checker` (web research + LLM) → `claims.checked`. Client events go via Redis Pub/Sub `session:{sessionId}:events` back through the gateway. `caddy` terminates TLS and is the only container with host ports. Details: brief sections 5–7.
