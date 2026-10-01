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
- Scores live only in the finished debate's result view and are shown to the participants
  together; no profiles, no history across debates, and the result view is excluded from every
  export (brief 11's Markdown summary and the phase-4 session export never contain it).
- Retention, precisely: the per-speaker aggregate and the exchange list the result view needs
  are the only data allowed to outlive ADR 0018's 15-minute stream retention. They live under
  one Redis key with a hard TTL of the debate's time budget plus 15 minutes grace, set at start -
  so an abandoned debate deletes itself; nothing waits for a clean end.
- Consent is two names and two checkmarks on one device. Without accounts (brief 3) the app
  cannot verify that the second checkmark was set by the second person; the dialog says the
  result will be shown to both, and the result appears only on that same device. The residual
  risk - one person faking the partner's consent to "score" an absent other - is accepted by
  the owner with this ADR, like the restart residual risk in ADR 0018.
- The verdict pipeline stays unchanged and neutral; the game adds a judge on top, it never bends
  verdicts toward the game.
- Wording stays factual ("mehr Belege genannt", "3 Aussagen falsch"), never personal ("Lügner").

## Alternatives

- Keep the ban entirely: rejected by the owner – the game is the point of this feature.
- Score silently without double consent: rejected; it would turn the app into a surveillance
  tool, against brief 2 and 15.6.

## Consequences

- The acceptance commit of this ADR also adds a one-line pointer to brief 11 (and names the
  feature in brief 17's backlog), so the brief and this exception never contradict each other,
  and extends the AGENTS.md workflow rule to cover owner-ordered `feature-*.md` plans.
- Contracts get debate events (own schemaVersion bump, plan `feature-debate-mode`).
- The new `debate-judge` service is its own architecture decision: TP D2 starts with an ADR
  (pattern: ADR 0009 for the explainer).
- Reliable per-speaker attribution is a hard prerequisite: diarization is phase-3 scope and
  cloud-only today (`stt-local` cannot separate speakers), so the debate mode is cloud-only
  until that changes, and mapping the consent names to the speaker labels A/B is its own task.
- The judge needs its own eval set with owner-reviewed labels before anyone trusts a score.
