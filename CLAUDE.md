@AGENTS.md

# Claude Code specifics

Only rules that apply to Claude Code alone. Everything else lives in `AGENTS.md`.

- Run `/compact` manually at about 60–70 % context usage instead of waiting for auto-compaction.
- Before `/compact`, write open points and insights into `## Status` of the current plan file yourself. The `PreCompact` hook only appends git metadata.
- Subagents in `.claude/agents/` are thin wrappers around the prompts in `.ai/prompts/`. Change the prompt, not the wrapper.
- Hooks in `.claude/settings.json` are comfort and early warning only. The real guards are lefthook and CI; never rely on a hook being present.
