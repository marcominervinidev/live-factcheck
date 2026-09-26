import type {
  Answers,
  BoolAnswer,
  ChoiceAnswer,
  Question,
  Questions,
  ScoreAnswer,
} from './types.js';

/**
 * The one confidence formula for every provider (ADR 0007, Jev's documented definition):
 * `clamp((n · p_max − 1) / (n − 1), 0, 1)`. 1 = all mass on one option, 0 = uniform.
 */
export function confidenceOf(probabilities: readonly number[]): number {
  const n = probabilities.length;
  if (n < 2) {
    return 1;
  }
  const max = Math.max(...probabilities);
  return Math.min(1, Math.max(0, (n * max - 1) / (n - 1)));
}

/** Scales non-negative values to sum 1. Rejects an all-zero distribution. */
export function normalize(values: readonly number[]): number[] {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) {
    throw new Error('cannot normalize a distribution without mass');
  }
  return values.map((value) => value / sum);
}

/**
 * Raw probabilities per question, as a provider produced them:
 * Choice → per option key, Score → per level index (`"0"`, `"1"`, …), Bool → one number.
 */
export type RawAnswer = number | Readonly<Record<string, number>>;

function choiceAnswer(
  options: readonly string[],
  raw: Readonly<Record<string, number>>,
): ChoiceAnswer {
  const probabilities = normalize(options.map((option) => raw[option] ?? 0));
  let best = 0;
  probabilities.forEach((p, i) => {
    if (p > (probabilities[best] ?? 0)) best = i;
  });
  return {
    type: 'choice',
    choice: options[best] ?? '',
    probabilities: Object.fromEntries(options.map((option, i) => [option, probabilities[i] ?? 0])),
    confidence: confidenceOf(probabilities),
  };
}

function scoreAnswer(levels: number, raw: Readonly<Record<string, number>>): ScoreAnswer {
  const keys = Array.from({ length: levels }, (_, i) => String(i));
  const probabilities = normalize(keys.map((key) => raw[key] ?? 0));
  return {
    type: 'score',
    score: probabilities.reduce((sum, p, i) => sum + p * i, 0),
    probabilities: Object.fromEntries(keys.map((key, i) => [key, probabilities[i] ?? 0])),
    confidence: confidenceOf(probabilities),
  };
}

function boolAnswer(probability: number): BoolAnswer {
  const p = Math.min(1, Math.max(0, probability));
  return {
    type: 'bool',
    probability: p,
    probabilities: { true: p, false: 1 - p },
    confidence: confidenceOf([p, 1 - p]),
  };
}

/** Turns raw probabilities into typed answers for one question. Throws on a shape mismatch. */
export function answerFor(question: Question, raw: RawAnswer | undefined) {
  switch (question.type) {
    case 'choice':
      if (typeof raw !== 'object') throw new Error('choice answer needs probabilities per option');
      return choiceAnswer(Object.keys(question.options), raw);
    case 'score':
      if (typeof raw !== 'object') throw new Error('score answer needs probabilities per level');
      return scoreAnswer(question.levels.length, raw);
    case 'bool':
      if (typeof raw !== 'number') throw new Error('bool answer needs one probability');
      return boolAnswer(raw);
  }
}

/** Builds typed answers for all questions from raw probabilities keyed by question id. */
export function answersFor<Q extends Questions>(
  questions: Q,
  raw: Readonly<Record<string, RawAnswer>>,
): Answers<Q> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [id, answerFor(question, raw[id])]),
  ) as Answers<Q>;
}
