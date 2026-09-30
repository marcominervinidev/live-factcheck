# 0019: Visual design for private conversations ("Familientisch")

- Status: accepted (owner, 2026-09-30)
- Date: 2026-09-30

## Context

Phase 2 built the live mode as a functional base (TP6). Before more UI work, the owner asked for a design pass (plan T6.5). The first MVP audience: people, politically left to centre, who talk politics with their parents or grandparents, e.g. at Christmas, and want the conversation to stay with the facts. The phone lies on the table or is handed across it; the person across the table may not know the app, may distrust it and may read without glasses.

## Decision

- **Palette after DocuSign** (owner's choice), read from docusign.com: ground `#F8F3F0`, surface `#FFFFFF`, text `#130032`, muted `#5A4E77`, controls `#4C00FF`, lilac `#CBC2FF` / `#EDE5FF`, live dot `#FF5252`.
- **Verdicts have their own colours**, never the control violet, so a verdict never looks like a button: false and exaggerated `#C8102E` on `#FFDCD8`, true `#0A7A54` on `#D4F3E5`, uncertain and not checkable in lilac grey. Every pair meets 4.5:1. Colour is never the only signal (icon and text, brief 11).
- **Dark mode** with the same palette: plum `#130032` ground, `#26065D` surface, lilac as control colour, lighter verdict colours (`#FFB3B3`, `#5FCFA8`). It follows the system at first; a round button in the header switches and the choice is remembered.
- **Type:** Plus Jakarta Sans, self-hosted (CSP `font-src 'self'`). DocuSign's own typeface is proprietary.
- **Flow:** start and text mode → consent in plain words ("Alle am Tisch wissen Bescheid?") → live transcript with the newest card at the bottom next to the thumb → **show mode** (hand the phone across: the claim as said, the verdict, one sentence, the sources) → a summary after the conversation, without scores per person.
- **Tone:** the app judges claims, never people or parties.
- The reference screens (18, light and dark, phone and desktop) live in the design canvas linked in the plan (T6.5); the UX checklist of the `ui-ux-pro-max` skill is the acceptance list for the implementation (focus rings, 44 px targets, reduced motion, errors with a next step).

## Alternatives

- Amber and blue verdicts on warm dark (the first "Familientisch" draft): calmer, but the owner preferred the DocuSign look.
- The skill's generic suggestion for a fact-check app (blue and orange, Inter and Playfair): a default, not a choice for this audience.

## Consequences

- All colours become tokens in `apps/web/src/styles.css`; components use token names, never palette classes, so the dark theme only redefines variables.
- A "game mode" (who kept to the facts) contradicts "no scores per person" and needs its own ADR before it is built.
