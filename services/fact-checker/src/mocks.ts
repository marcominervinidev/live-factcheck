// Deterministic stand-ins for the system boundaries (LLM, classifier, search, the internet) used
// with `*_PROVIDER=mock` and `CHECKER_RESEARCH_SOURCES=mock`: CI and the stage 3/4 tests run the
// real pipeline without keys or external network (brief 13.1). Never used in production config.
import type {
  MockClassifierHandler,
  MockLlmHandler,
  MockSearchHandler,
  RawAnswer,
} from '@lfc/providers';
import type { ResearchResult } from '@lfc/research';

/** The claims the E2E and API tests use, with the verdict the mock classifier gives them. */
const RULES: readonly { readonly match: RegExp; readonly verdict: Record<string, number> }[] = [
  // Brief example: clearly false, high confidence.
  {
    match: /20 Jahre vorbei|endete 1965/i,
    verdict: {
      falsch: 0.93,
      uebertrieben: 0.03,
      stimmt: 0.01,
      groesstenteils_richtig: 0.01,
      nicht_pruefbar: 0.02,
    },
  },
  // Clearly true, high confidence.
  {
    match: /endete 1945|1945 endete/i,
    verdict: {
      stimmt: 0.92,
      groesstenteils_richtig: 0.05,
      uebertrieben: 0.01,
      falsch: 0.01,
      nicht_pruefbar: 0.01,
    },
  },
  // Medium confidence (0.65 over five verdicts → 0.56) → shown as "unsicher" (brief 11).
  {
    match: /Einwohner/i,
    verdict: {
      groesstenteils_richtig: 0.65,
      stimmt: 0.2,
      uebertrieben: 0.1,
      falsch: 0.03,
      nicht_pruefbar: 0.02,
    },
  },
  // Opinion → nicht_pruefbar.
  {
    match: /ich finde|schönste/i,
    verdict: {
      nicht_pruefbar: 0.9,
      stimmt: 0.03,
      groesstenteils_richtig: 0.03,
      uebertrieben: 0.02,
      falsch: 0.02,
    },
  },
];
const DEFAULT_VERDICT = {
  nicht_pruefbar: 0.5,
  stimmt: 0.2,
  groesstenteils_richtig: 0.1,
  uebertrieben: 0.1,
  falsch: 0.1,
};

const claimOf = (state: unknown): string =>
  typeof state === 'object' && state !== null && 'claim' in state && typeof state.claim === 'string'
    ? state.claim
    : String(state);

export const mockClassifier: MockClassifierHandler = (state, questions) => {
  const claim = claimOf(state);
  const verdict = RULES.find((rule) => rule.match.test(claim))?.verdict ?? DEFAULT_VERDICT;
  const answers: Record<string, RawAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'bool') {
      answers[id] = 0.9; // every snippet relevant, evidence sufficient
    } else if (question.type === 'choice' && id === 'verdict') {
      answers[id] = verdict;
    } else if (question.type === 'choice') {
      const [first] = Object.keys(question.options);
      answers[id] = Object.fromEntries(
        Object.keys(question.options).map((key) => [key, key === first ? 0.9 : 0.1]),
      );
    } else {
      answers[id] = Object.fromEntries(
        question.levels.map((_, i) => [String(i), i === question.levels.length - 1 ? 1 : 0]),
      );
    }
  }
  return answers;
};

/** Search queries: the claim itself. */
export const mockLlm: MockLlmHandler = (request) => {
  const claim = /<claim>\n([\s\S]*)\n<\/claim>/.exec(request.user)?.[1]?.trim() ?? request.user;
  return { queries: [claim] };
};

export const mockSearch: MockSearchHandler = () => [];

const CORPUS = [
  {
    url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
    title: 'Zweiter Weltkrieg',
    publisher: 'Wikipedia',
    tier: 'referenz' as const,
    weight: 0.8,
    text: 'Der Zweite Weltkrieg war vom 1. September 1939 bis zum 2. September 1945 der zweite global geführte Krieg. In Europa endete er am 8. Mai 1945 mit der bedingungslosen Kapitulation der Wehrmacht.',
  },
  {
    url: 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/_inhalt.html',
    title: 'Bevölkerungsstand',
    publisher: 'Statistisches Bundesamt',
    tier: 'amtlich' as const,
    weight: 0.9,
    text: 'Berlin hatte Ende 2024 rund 3,9 Millionen Einwohner und ist damit die bevölkerungsreichste Stadt Deutschlands.',
  },
];

/** A fixed local corpus instead of the internet; the real ranking and classifier code run on it. */
export function mockResearch(
  now: () => Date,
): (input: { readonly claim: string }) => Promise<ResearchResult> {
  return (input) =>
    Promise.resolve({
      documents: CORPUS.map((doc) => ({ ...doc, retrievedAt: now().toISOString() })),
      // The brief's example claim also has an existing fact check ("bereits von … geprüft").
      factChecks: /20 Jahre vorbei/i.test(input.claim)
        ? [
            {
              claimText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei',
              publisher: 'Beispiel-Faktencheck',
              url: 'https://faktencheck.example.org/zweiter-weltkrieg',
              rating: 'Falsch',
            },
          ]
        : [],
      failures: [],
    });
}
