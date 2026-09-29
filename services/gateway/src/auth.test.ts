import { describe, expect, it } from 'vitest';

import { bearerToken, tokenMatches } from './auth.js';

describe('tokenMatches (ADR 0011)', () => {
  const token = 'a'.repeat(40);
  it('accepts only the exact token', () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token, `${token}x`)).toBe(false);
    expect(tokenMatches(token, token.slice(1))).toBe(false);
    expect(tokenMatches(token, '')).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', undefined],
    ['Bearer', undefined],
    ['Bearer a b', undefined],
    ['Basic abc', undefined],
    [undefined, undefined],
  ])('%s → %s', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });
});
