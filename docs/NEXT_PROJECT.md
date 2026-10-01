# Next project, from day one

What this project had to learn along the way and would set up from the start next time – the
"software factory" starter list. Curated, not a diary: each line names where it came from. The
retro at every gate asks whether a finding belongs here (skill `retro`).

## Tooling and runtime

- Toolbox container for all dev tooling; the host keeps only Docker and Git. Proven here, keep.
- Long-running measurements (mutation testing, evals) run in a **throwaway clone**, never in the
  working tree the agent is editing – two clashes on one evening (lessons 2026-09-30).
- Evaluate **OrbStack over Docker Desktop** on small Macs before starting: the 8 GB Docker VM
  swapped hard and its disk filled three times (phase 2).
- Schedule image and build-cache hygiene (the disk filled mid-phase; 33 GB reclaimed 2026-09-30).
- Distroless runtime images from the first service, **including Python** (stt-local ships Debian
  with 44 HIGH findings; swap planned only after phase 2).

## Quality gates

- Mutation testing (Stryker, nightly) from the **first** package, not retrofitted across ten
  (PR `test/stryker-all-packages`); thresholds measured, never wished.
- Child-process startup tests get load headroom (60 s) from the start – CI machines and busy
  toolboxes are slow (lesson 2026-09-30, twice).
- Run the browsers' real security context early: the CSP `font-src` violation only surfaced at
  stage 4 because `vite preview` (stage 2b) has no CSP (PR #47).
- `docs/CODING_STANDARDS.md` (judgement calls for the review; mechanical rules become checks)
  and the reviewer prompt come from the template of this repo, day one.

## Process

- Adopt the whole review package of PR #50 at project start: merge-danger block (risk from
  revertibility + blast radius, value, review depth), compact PRs with collapsed sections,
  structure sketches, visual guide for UI PRs, Agent-Bilanz per PR, retro at every gate.
- PR size (~400 lines of production code) and commits in review order from PR 1 – retrofitting
  the rules cost an owner intervention ("PRs too large", 2026-09-30).
- Every plan task carries **risk level and session type** (research / prototype / clarify /
  implement). UI or foggy concepts get a throwaway **prototype with variants first, and the
  owner picks** – the agent never decides the variant (T6.5 design canvas worked exactly so).
- For foggy, multi-session planning, start from the **wayfinder skill** ([mattpocock/skills](https://github.com/mattpocock/skills), MIT): a map of decision tickets (research / prototype / clarify / task) with blockers and a frontier, worked off one session per ticket. Here we rebuilt its core as plan-file task types late (2026-10-01); next time adopt or adapt it on day one.
- The plan file in the repo stays the tool-neutral source of truth; GitHub issues hold only the
  backlog and the owner's open items (decision 2026-09-30, after the Wayfinder comparison).
- `.ai/lessons.md` with the promotion rule (second occurrence → check or rule) from day one.
- Agree the language rules first (German to the owner, English artefacts): learned after three
  corrections (2026-09-30).

## Architecture

- `packages/contracts` read-only with the schemaVersion guard from the first event.
- Conversation language is a parameter from the first prompt and STT call – retrofitting left
  ten `LANG-EN:` markers (ADR 0020).
- Secrets as `<NAME>_FILE` plus an isolated verify stack (`COMPOSE_PROJECT_NAME`, throwaway
  secrets dir) from the first compose file.
