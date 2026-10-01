@AGENTS.md

# Claude Code specifics

Only rules that apply to Claude Code alone. Everything else lives in `AGENTS.md`.

- Run `/compact` manually at about 60–70 % context usage instead of waiting for auto-compaction.
- Before `/compact`, write open points and insights into `## Status` of the current plan file yourself. The `PreCompact` hook only appends git metadata.
- Subagents in `.claude/agents/` are thin wrappers around the prompts in `.ai/prompts/`. Change the prompt, not the wrapper.
- Run subagents in the background for exploration and for reviewer + security-reviewer in parallel before a PR. Every git-touching step (edit, commit, branch switch) stays in the main session, one at a time (AGENTS.md, "Parallel work").
- Hooks in `.claude/settings.json` are comfort and early warning only. The real guards are lefthook and CI; never rely on a hook being present.
