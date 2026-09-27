import { describe, expect, it } from 'vitest';

import { bearerToken, tokenMatches } from './auth.js';
import { normalizeClaimText } from './normalize.js';

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

describe('normalizeClaimText (ADR 0008 cache key)', () => {
  it.each([
    ['Der Zweite Weltkrieg endete 1945.', 'der zweite weltkrieg endete 1945'],
    ['  „Der Krieg“   endete\n1945!!! ', '"der krieg" endete 1945'],
    ['Ｂｅｒｌｉｎ hat 3,9 Mio. Einwohner', 'berlin hat 3,9 mio. einwohner'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeClaimText(input)).toBe(expected);
  });

  it('keeps numbers and negations apart', () => {
    expect(normalizeClaimText('Der Krieg endete 1945')).not.toBe(
      normalizeClaimText('Der Krieg endete 1965'),
    );
    expect(normalizeClaimText('Das stimmt.')).not.toBe(normalizeClaimText('Das stimmt nicht.'));
  });
});
