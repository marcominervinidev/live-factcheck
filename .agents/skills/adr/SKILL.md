---
name: adr
description: "Create a new Architecture Decision Record in docs/adr/ with the next free number from the template. Use for every non-trivial architecture decision, including approved contract changes and deviations from the project brief."
---

# Create an ADR

1. Find the next number: the highest `NNNN` in `docs/adr/` plus one, zero-padded to four digits. `0000` is the template and never used.
2. Copy `docs/adr/0000-template.md` to `docs/adr/NNNN-<kebab-case-title>.md`.
3. Fill in:
   - title line `# NNNN: <Title>`
   - `Status: proposed` (the owner sets `accepted` by merging), `Date:` today (YYYY-MM-DD)
   - **Context**: the problem and the constraints from `docs/PROJECT_BRIEF.md`, with section numbers
   - **Decision**: what we do, stated plainly
   - **Alternatives**: each real option and why it lost
   - **Consequences**: follow-up work, risks, how we notice if it was wrong
4. If the decision deviates from the brief, say so in Context and name the brief section.
5. If it replaces an earlier ADR, set the old one to `Status: superseded by NNNN`.
6. Commit the ADR together with the change it documents (`docs(adr): …` only if it stands alone).

Keep it short: one screen is the target. English, like all repo docs except the brief.
