# 0021: Debate mode – per-person scores only inside an explicit game

- Status: proposed
- Date: 2026-09-30

## Context

Brief 11 and ADR 0019 rule out scores per person: the app judges claims, not people. The owner
now orders a debate mode as the last currently planned feature (2026-09-30), inspired by the
tradition of university debating societies: two people debate one topic for up to two hours;
afterwards the app tells who won more exchanges on the merits and how often each said something
untrue, combined into a score. That is a deliberate exception to the rule, so it needs this ADR
(as ADR 0019 already noted).

## Decision

Per-person scoring exists **only inside the debate game**:

- Both participants opt in, by name, before the recording starts; the consent dialog names the
  game, the metrics and who will see the result. No opt-in, no debate mode – the standard mode
  stays exactly as it is, judgement-free toward people.
- Scores live only in the finished debate's result view, are shown to the participants together,
  and follow the same retention as everything else (deleted with the session; no profiles, no
  history across debates).
- The verdict pipeline stays unchanged and neutral; the game adds a judge on top, it never bends
  verdicts toward the game.
- Wording stays factual ("mehr Belege genannt", "3 Aussagen falsch"), never personal ("Lügner").

## Alternatives

- Keep the ban entirely: rejected by the owner – the game is the point of this feature.
- Score silently without double consent: rejected; it would turn the app into a surveillance
  tool, against brief 2 and 15.6.

## Consequences

- Contracts get debate events (own schemaVersion bump, plan `feature-debate-mode`).
- The judge needs its own eval set with owner-reviewed labels before anyone trusts a score.
- Retention for a two-hour debate exceeds the 15-minute stream retention (ADR 0018); the debate
  aggregate is kept per session until it ends, then deleted like the rest.
