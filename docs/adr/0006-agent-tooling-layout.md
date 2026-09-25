# 0006: Agent tooling layout for Claude Code and Antigravity

- Status: accepted
- Date: 2026-09-25

## Context

Brief 1.1 and 1.4 require that Claude Code (primary) and Google Antigravity (fallback when the Claude usage limit is reached) work with the same rules, prompts, skills and MCP servers, and that the real safeguards do not depend on either tool. The brief assumed an Antigravity MCP template written to `~/.gemini/antigravity/mcp_config.json` by `make agent-setup`, a Docker MCP server from phase 0, and Antigravity workflows for the review roles. Research on 2026-09-25 (`.ai/research/antigravity.md`, `.ai/research/mcp-servers.md`) showed that Antigravity has changed since the brief was written.

## Decision

**Single sources, thin wrappers**

| Building block | Source of truth | Claude Code | Antigravity |
|---|---|---|---|
| Rules | `AGENTS.md` (root and per package) | `CLAUDE.md` = `@AGENTS.md` + Claude-only rules | root `AGENTS.md` read directly; nested ones via glob rules in `.agents/rules/<pkg>.md` that inline them with `@[…](…)` |
| Roles | `.ai/prompts/<role>.md` | `.claude/agents/<role>.md` | `.agents/agents/<role>.md` (subagents) |
| Skills | `.agents/skills/<name>/SKILL.md` | `.claude/skills` → symlink | read directly, `/<name>` |
| MCP | same servers and launch commands | `.mcp.json` | `.agents/mcp_config.json` (workspace file, committed) |

Wrappers only say "read `.ai/prompts/<role>.md` and follow it", because Antigravity subagent bodies cannot include files. A CI step (`scripts/ci/check-mcp-parity.mjs`) fails if the two MCP files drift apart.

**MCP servers:** GitHub (official image, toolsets `repos,issues,pull_requests,actions`, token from `GITHUB_MCP_TOKEN` or `gh auth token` at launch), Context7 (remote), Redis (official `mcp/redis`, pinned by digest, dedicated read-only ACL user `mcp` with its own secret `redis_mcp_password`). Servers start through `/bin/zsh -lc` so the GUI app Antigravity gets the user's PATH and env, and no token is ever written to a file.

**No Docker MCP** (owner's decision): there is no official, maintained Docker MCP server (`mcp/docker` is a stale gateway), every option needs the Docker socket, and both tools already have a terminal with `docker compose ps|logs|exec`, which also produces better evidence.

**No Antigravity workflows:** they are deprecated and retired on 2026-11-01; skills replace them.

**Agent hooks** (`.claude/settings.json`) stay Claude-only comfort: secrets guard, contract edit confirmation (`ask`), format/lint after edits, unit tests on stop, plan status on session start, git state before compaction. The real guards are lefthook, CI and branch protection.

## Alternatives

- **`make agent-setup` writing a global Antigravity config** (brief): not needed now that the workspace file exists; a global file would apply to every project and needs absolute paths.
- **Duplicated prompt text in each tool's agent file:** simpler to read, but drifts.
- **Community Docker MCP server** (`ckreiling/mcp-server-docker`): not official, socket access, and not needed for the evidence.
- **Tokens via `${VAR}` interpolation in the config:** Claude Code supports it, Antigravity documents no interpolation; the shell launch works identically in both.

## Consequences

- The brief's sections 1.1, 1.4 and 16 are updated in the same PR.
- Antigravity behaviour (subagent pickup, glob-rule inlining, MCP launch via `zsh -lc`) is unverified until the owner's first Antigravity session (plan task T7.4).
- Every new package or service needs a glob rule in `.agents/rules/` (part of the skill `new-service`).
- The Redis MCP only works once the Compose stack with the `mcp` ACL user runs (TP5).
