import { describe, expect, it } from 'vitest';

import { answersFor, confidenceOf, normalize } from './answers.js';

describe('confidenceOf (ADR 0007, Jev definition)', () => {
  it.each([
    ['all mass on one of three', [1, 0, 0], 1],
    ['uniform over three', [1 / 3, 1 / 3, 1 / 3], 0],
    ['Jev docs score example (0 / 0.95 / 0.05 → 0.92)', [0, 0.95, 0.05], 0.925],
    [
      'Jev docs choice example (0.88 / 0.12 / 0 → 0.81 with unrounded values)',
      [0.88, 0.12, 0],
      0.82,
    ],
    ['bool 0.9', [0.9, 0.1], 0.8],
    ['bool 0.5', [0.5, 0.5], 0],
  ])('%s', (_label, probabilities, expected) => {
    expect(confidenceOf(probabilities)).toBeCloseTo(expected, 3);
  });

  it('stays within 0..1 for any distribution', () => {
    for (let i = 0; i < 200; i++) {
      const raw = Array.from({ length: 2 + (i % 5) }, (_, j) => ((i * 7 + j * 13) % 11) + 0.01);
      const c = confidenceOf(normalize(raw));
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('answersFor', () => {
  const questions = {
    verdict: {
      type: 'choice',
      instructions: 'Which verdict?',
      options: { stimmt: null, falsch: 'contradicted by the evidence' },
    },
    checkworthiness: {
      type: 'score',
      instructions: 'How check-worthy?',
      levels: ['low', 'mid', 'high'],
    },
    relevant: { type: 'bool', instructions: 'Is the snippet relevant?' },
  } as const;

  it('normalises, picks the most probable option and computes confidence', () => {
    const answers = answersFor(questions, {
      verdict: { stimmt: 0.1, falsch: 0.95 },
      checkworthiness: { '0': 0, '1': 0.5, '2': 0.5 },
      relevant: 0.9,
    });
    expect(answers.verdict.choice).toBe('falsch');
    expect(answers.verdict.probabilities.falsch).toBeCloseTo(0.95 / 1.05, 6);
    expect(answers.checkworthiness.score).toBeCloseTo(1.5, 6);
    expect(answers.relevant).toEqual({
      type: 'bool',
      probability: 0.9,
      probabilities: { true: 0.9, false: expect.closeTo(0.1, 6) as number },
      confidence: expect.closeTo(0.8, 6) as number,
    });
  });

  it('treats a missing option as 0 and keeps option order on ties', () => {
    const answers = answersFor(
      { v: { type: 'choice', instructions: 'x', options: { a: null, b: null, c: null } } },
      { v: { b: 0.5, c: 0.5 } },
    );
    expect(answers.v.choice).toBe('b');
    expect(answers.v.probabilities.a).toBe(0);
  });

  it('rejects answers of the wrong shape and distributions without mass', () => {
    expect(() =>
      answersFor(questions, { verdict: 0.5, checkworthiness: {}, relevant: 0.5 }),
    ).toThrow();
    expect(() =>
      answersFor(questions, {
        verdict: { stimmt: 0, falsch: 0 },
        checkworthiness: { '0': 1 },
        relevant: 1,
      }),
    ).toThrow('without mass');
  });
});
