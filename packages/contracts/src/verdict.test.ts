import { describe, expect, it } from 'vitest';

import { VERDICTS, VerdictProbabilities } from './verdict.js';

const uniform = () => Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0.2]));

describe('VerdictProbabilities', () => {
  it('accepts a distribution over all five verdicts', () => {
    expect(VerdictProbabilities.safeParse(uniform()).success).toBe(true);
  });

  it('tolerates rounding up to 0.001', () => {
    expect(VerdictProbabilities.safeParse({ ...uniform(), stimmt: 0.2009 }).success).toBe(true);
    expect(VerdictProbabilities.safeParse({ ...uniform(), stimmt: 0.202 }).success).toBe(false);
  });

  it.each([
    ['a negative probability', { stimmt: -0.1, falsch: 0.5 }],
    ['a probability above 1', { stimmt: 1.2, falsch: -0.2 }],
    ['an unknown verdict', { wahr: 0 }],
  ])('rejects %s', (_label, override) => {
    expect(VerdictProbabilities.safeParse({ ...uniform(), ...override }).success).toBe(false);
  });
});
