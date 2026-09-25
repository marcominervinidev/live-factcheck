# Google Antigravity configuration (research, 2026-09-25)

What Antigravity reads, compared with Claude Code, and how this repo maps onto it.

| Concept | Antigravity (workspace) | Antigravity (global) | Claude Code | This repo |
|---|---|---|---|---|
| Root rules | `AGENTS.md` or `GEMINI.md` at root (since 1.20.5), plus `.agents/rules/*.md` | `~/.gemini/GEMINI.md` | `CLAUDE.md` (imports `@AGENTS.md`) | `AGENTS.md` is authoritative |
| Nested rules | **not** auto-discovered | – | nested `CLAUDE.md` load on access | `.agents/rules/<pkg>.md` with `trigger: glob` that inlines `packages/<pkg>/AGENTS.md` via `@[label](path)` |
| Skills | `.agents/skills/<name>/SKILL.md`, invokable as `/<name>` | `~/.gemini/config/skills/` | `.claude/skills/` | `.agents/skills/`, `.claude/skills` is a symlink |
| Subagents | `.agents/agents/<name>.md` (frontmatter `name`, `description`, `tools`, `model`, `subagent: true`) | `~/.gemini/config/agents/` | `.claude/agents/<name>.md` | thin wrappers in both, prompt body in `.ai/prompts/` |
| Workflows | `.agents/workflows/` – **deprecated, retired 2026-11-01**, replaced by skills | – | – | not used |
| MCP | `.agents/mcp_config.json` (`mcpServers`, stdio: `command/args/env/cwd`, remote: `serverUrl`) | `~/.gemini/config/mcp_config.json` | `.mcp.json` (remote: `type: http`, `url`) | both files committed, same servers |

## Rule file format (`.agents/rules/*.md`)

- YAML frontmatter with required `trigger`: `always_on`, `model_decision` (needs `description`), `glob` (needs `globs: "a/**, b/**"`) or `manual`.
- `@[label](path)` inlines another file; `@path` only resolves it.
- Limits: 24 KB per file, 20k tokens for all always-on rules together.

## Consequences for the brief

- The brief's `tools/antigravity/mcp_config.example.json` + `make agent-setup` (writing `~/.gemini/antigravity/mcp_config.json`) is no longer needed: the workspace file is picked up directly, is versioned and needs no absolute paths.
- Environment variable interpolation in `mcp_config.json` is not documented, so secrets are resolved by the launch command (`zsh -lc`), never written into the file.
- Subagent bodies cannot include files; wrappers instruct the agent to read `.ai/prompts/<name>.md` first.

Unverified until Marco's first Antigravity session (T7.4): subagent pickup from `.agents/agents/`, the glob-rule inlining of nested `AGENTS.md`, and MCP startup through `zsh -lc`.

Sources: antigravity.google/docs/skills, antigravity.google/docs/rules, antigravity.google/docs/mcp, antigravity.google/docs/subagents, antigravity.google/docs/migration/workflows-to-skills, atamel.dev/posts/2026/08-21_where_agy_configuration_summary, thepromptshelf.dev/blog/google-antigravity-agents-md-rules-guide-2026
