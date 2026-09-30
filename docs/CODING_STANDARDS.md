# Coding standards

Judgement calls the automated review enforces (`.ai/prompts/reviewer.md` reads this file; the
implementation does not – AGENTS.md stays navigation and workflow). Two rules keep this file
honest:

- **Mechanical rules do not live here.** Anything a tool can check (function length, complexity,
  parameter count, import shapes, banned APIs) becomes an ESLint, dependency-cruiser, Sonar or CI
  rule instead of prose.
- **It grows through retros, never by copying books.** A review comment that would be written a
  second time becomes a check or a standard here (`.ai/lessons.md` workflow). Entries name the
  lesson or PR they came from where one exists.

Rules in `AGENTS.md` files are binding anyway and are not repeated here.

## Deep modules

- Hide behaviour behind the smallest interface that serves the caller; the caller should get much
  for calling little (leverage). One concept, one place: e.g. `apps/web/src/lib/format.ts` is the
  only verdict→label/colour/icon mapping, `audio/pcm.ts` the only sample→PCM16 place.
- Never add exports, parameters or config only so tests can reach internals. Tests go through the
  public interface; if that makes behaviour untestable, the interface is wrong – fix the design.
- New behaviour goes into the module that owns the concept, not beside it (locality: a small
  change should not ripple across files).

## Tests as behaviour

Scope: unit tests (stage 1) and pure-logic integration tests. The UI and E2E stages (2b/3/4)
replay user behaviour on purpose – stable test ids, clicked flows and visible texts are the
point there, not a smell. What stays tautological on every stage: asserting back exactly what
the test's own mock injected, without asserting a user-visible outcome.

- A test states an observable behaviour, not the implementation: no asserting a constant against
  its own literal, no reading source files, no pinning internal call order. If a refactor that
  keeps behaviour breaks the test, the test was wrong.
- Mock only at system boundaries; asserting "the mock was called with X" without asserting an
  outcome tests nothing.

## Naming and language

- Names say what something is or does in the domain's words (session, claim, verdict, segment);
  a name that needs a comment is the finding. No abbreviations beyond common ones (id, url, ws).
- One name per concept across the codebase; do not rename a concept at a boundary.

## Honest errors

- Fail fast and loud: no silent defaults, no swallowed errors, no broad catch that logs and
  continues as if nothing happened. Error messages name what failed and what the operator can do,
  never secret values.
- Impossible states are unrepresentable where cheap: narrow unions and zod schemas over wide
  types plus runtime hope.

## Comments

- Comments explain why (constraints, decisions, links to ADR/brief), not what the code already
  says. Every suppression (`eslint-disable`, `@ts-expect-error`, `nosemgrep`) carries its reason.

## Structure smells worth reporting

Heuristics, not laws – report with file:line and a suggestion (Fowler, *Refactoring* ch. 3):

- **Feature envy:** a function working mostly on another module's data belongs there.
- **Data clump:** the same fields travelling together want to be a type.
- **Primitive obsession:** a domain concept passed around as bare string/number instead of a
  contract type or narrow union.
- **Shotgun surgery:** one logical change forcing edits across many files – gather it.
- **Speculative generality:** abstractions, flags or hooks with a single caller and no task in
  the plan – delete or inline (AGENTS.md "no overbuild").
