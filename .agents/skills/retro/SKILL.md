---
name: retro
description: "Retrospective over the merged PRs and sessions since the last review gate. Run at every gate (AGENTS.md workflow) or when the owner asks. Suggests automated checks, coding standards, navigation pointers and slimmer steering files; the owner decides, the skill changes nothing itself."
---

# Retrospective at a review gate

You are reviewing the **system that produces the code**, not the code: the goal is that no
review comment, agent mistake or detour happens a second time. Suggest improvements; never
apply one without the owner's approval. Report to the owner in German.

## 1. Collect the period

- The current plan's `## Status` and the last gate before this one.
- Merged PRs since then: `gh pr list --state merged --base main --json number,title,mergedAt,url`
  (filter by date); for each, the review guide and any owner comments (`gh pr view <n> --comments`).
- `.ai/lessons.md` rows from the period, and which are not promoted yet.
- The current session, plus session notes in the plan's `## Session-Log` where present.
- The period's owner decisions (plan `## Status`, PR checkboxes, chat): name the commit that
  implemented each one. A decided-but-never-landed change is itself a finding (the Sonar
  coverage exception from 2026-09-30 only landed a day later, as a red quality gate).

## 2. Look for candidates, in this order

The order is the preference: a deterministic check beats a prompt rule beats prose.

1. **Automated checks:** mistakes (or review findings) a lint rule, type, contract test, hook or
   CI job could have caught. Check first whether the repo already has the check but it is
   unwired or not strict enough – then that is the finding. Prefer the narrowest tool that
   catches it deterministically (ESLint rule, depcruise rule, zod schema, lefthook step, CI job).
2. **Reviewer prompt / coding standards:** judgement-call findings the automated review missed
   or would miss again → a rule in `docs/CODING_STANDARDS.md` or a check item in
   `.ai/prompts/reviewer.md` (never both). Also the reverse: rules there that a new tool now
   covers → remove the prose.
3. **Distribution check (every gate):** does anything in `AGENTS.md` (root or nested) belong in
   the reviewer prompt, a coding standard or an automated check instead? AGENTS.md stays
   navigation, workflow and hard boundaries.
4. **Navigation pointers:** where did an agent search long or guess wrong? Would one pointer
   line (in the narrowest AGENTS.md) have saved the detour?
5. **Tool economy:** expensive or repeated tool calls that a script, make target or note could
   replace; token-heavy outputs that could be filtered at the source.
6. **Next project:** would this finding change how the next project starts (tooling, day-one
   checks, process)? Then add it to `docs/NEXT_PROJECT.md` with its origin.
7. **Bloat and no-ops:** steering files, skills or prompts that grew without effect; rules that
   never changed behaviour; duplicated rules across files. Suggest deletions – shorter steering
   is a result, not a loss.

Alongside the candidates, refresh the agent numbers for the period
(`python3 scripts/agent-usage.py --since <last gate> --html <file>`, republish the private
"Agenten-Bilanz" artifact) and read them for findings: a tool with a high error share, growing
identical repeats, or one tool's results dominating the context are tool-economy candidates;
fix-commits after a red first CI run per PR are the Pass@1 signal.

## 3. Report

Number the suggestions, most valuable first. Per suggestion:

- **Befund:** what happened, with the evidence (PR, commit, file:line, lesson row).
- **Vorschlag:** the concrete change, named by target file or tool, and why this layer
  (check > prompt > prose).
- **Aufwand:** klein / mittel / groß.

End with the ones you checked and found healthy (one line each), so the owner sees what was
covered. If the period is clean, say so – an empty retro is a valid result.

## 4. After the owner decides

- Implement accepted suggestions before the next task block (own PR or with the gate's docs).
- Mark the covered `.ai/lessons.md` rows as promoted, and add new lesson rows for anything the
  retro found that stays unfixed for now.
