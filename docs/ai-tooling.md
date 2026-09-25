# AI tooling: Claude Code and Antigravity

This repo is built with a coding agent: Claude Code as the primary tool and Google Antigravity as the fallback when the Claude usage limit is reached. Both tools work from the same rules, prompts, skills and MCP servers; the safeguards that matter (git hooks, CI, branch protection) apply to every tool. Design: [ADR 0006](adr/0006-agent-tooling-layout.md).

## Where things live

| What | Source | Claude Code | Antigravity |
|---|---|---|---|
| Rules | `AGENTS.md` (root, per package) | `CLAUDE.md` imports `@AGENTS.md` | reads root `AGENTS.md`; nested ones via `.agents/rules/*.md` |
| Roles (reviewer, security-reviewer, platform-engineer) | `.ai/prompts/` | `.claude/agents/` | `.agents/agents/` |
| Skills (`new-service`, `new-event-contract`, `adr`, `evidence`) | `.agents/skills/` | `.claude/skills` (symlink) | `.agents/skills/` |
| MCP servers | GitHub, Context7, Redis | `.mcp.json` | `.agents/mcp_config.json` |
| Hooks | – | `.claude/settings.json` (comfort only) | – |
| Real guards | `lefthook.yml`, `.github/workflows/`, branch ruleset, `CODEOWNERS` | same | same |
| Plan and state | `.ai/plans/`, ADRs, git history | same | same |

## Set up a new machine

Prerequisites on the host: Docker Desktop, Git, VS Code, the GitHub CLI and the agent tools. No Node or Python.

```sh
brew install gh && gh auth login          # used by the GitHub MCP server and for PRs
git clone https://github.com/marcominervinidev/live-factcheck.git && cd live-factcheck
make toolbox install hooks-install        # dev container, dependencies, pre-commit hook
make secrets-init                          # creates ~/.config/live-factcheck/secrets; fill the files yourself
```

Optional, recommended: create a fine-grained GitHub token limited to this repository (contents, issues, pull requests, actions: read/write) and export it as `GITHUB_MCP_TOKEN` in `~/.zprofile`. Without it, the MCP server uses your `gh` login, which has broader scopes.

### Claude Code

1. Open the repo folder in VS Code and start Claude Code.
2. Approve the project MCP servers (`/mcp` lists `github`, `context7`, `redis`) and the project hooks when asked.
3. Keep the permission mode so that terminal commands need your approval. Never approve a command that touches `~/.config/live-factcheck/secrets`.

### Antigravity

1. Open the repo folder as workspace. Antigravity reads `AGENTS.md`, `.agents/rules/`, `.agents/skills/`, `.agents/agents/` and `.agents/mcp_config.json` from the workspace.
2. Set the terminal command policy to require approval (no auto-run).
3. Check that the MCP servers start (they launch through `/bin/zsh -lc`, so `docker` and `gh` must be on the PATH of your login shell).

The Redis MCP server connects as the read-only ACL user `mcp` to the Compose network `live-factcheck_internal`; it works once the stack runs (`make up`).

## Switching tools

1. Switch only at a review gate, never in the middle of a task.
2. Before switching: update `## Status` in the current plan (`.ai/plans/phase-N-….md`), commit the work in progress on the feature branch (prefix `wip:` is fine).
3. Start the new session with: "Read `AGENTS.md` and `.ai/plans/phase-N-….md` and continue with the next open task."
4. Note in the PR which tasks were done with which tool, so the review can focus accordingly.

## Why there is no Docker MCP server

No official, maintained Docker MCP server exists, and every option needs the Docker socket (root on the Docker host). Both agents have a terminal; `docker compose ps`, `logs` and `exec` provide the same information and produce better evidence.
