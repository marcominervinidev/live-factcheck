# 0020: Languages – English interface now, English conversations after launch

- Status: accepted (owner, 2026-09-30)
- Date: 2026-09-30

## Context

The app is German-only. The owner asked what English would take. It is two different things:

1. **Interface language:** buttons, notices, verdict labels. The texts already live in `apps/web/src/i18n/de.json` behind `t()`.
2. **Conversation language:** what the pipeline understands and checks. German is hard-wired in speech-to-text, the pre-filter, the prompts, the research sources and the eval sets.

## Decision

- **Now (phase 2, with the design implementation):** English interface. `en.json` with the same keys, the device language as default, a switch in the settings next to the theme, `lang` and date formats per language. Conversations stay German.
- **After launch, as one of the first features:** English conversations. Every code and config place that assumes German carries a comment starting with `LANG-EN:` (`git grep -n "LANG-EN:"` lists them); prompt files get no marker, because their text goes to the model – the table below names them.
- New code that depends on the conversation language takes the language as a parameter (the `language` field every event already carries) instead of hard-coding `de`, so the later work does not grow.

| Place | Today | For English conversations |
|---|---|---|
| Recording start (`apps/web/src/state/recording.ts`) | sends `language: 'de'` | send the chosen conversation language |
| STT (`packages/providers/src/stt/config.ts`) | `STT_LANGUAGE` default `de` | per recording from the start message |
| Number words (`services/transcription/src/numbers.ts`) | German only | not needed for English (Deepgram writes digits); already limited to `de` |
| Pre-filter (`services/claim-extractor/src/prefilter.ts`) | German greetings, opinion markers, fact signals (being a question is no drop reason since ADR 0017, amendment 2026-10-02) | word lists per language |
| Classifier questions and prompts (`detect.ts`, `prompts/*.md`, `fact-checker/prompts`, `explainer/prompts`) | German | per language, or English prompts that answer in the conversation language |
| Research (`packages/research/src/sources/wiki.ts`, `web.ts`, `services/fact-checker/src/wiring.ts`) | de.wikipedia, Wikidata labels `de`, search `language: 'de'`, Google Fact Check `de` | language as a parameter through the research |
| Source tiers (`config/source-tiers.yaml`) | German domains | add English outlets and agencies |
| Evals (`evals/*.jsonl`) | German sets | an English detection and verdict set with owner-reviewed labels |

## Alternatives

- Both now: roughly a week more before the phase ends, for an audience the MVP does not target.
- Nothing now: the interface would have to be touched again later; it is cheap now because the texts are already separated.

## Consequences

- Tests: an i18n test fails when a key is missing in one language; stage 2b runs once in English.
- Conversation language becomes its own entry in the backlog after launch; its size is about one week, half of it eval data and measurement.
