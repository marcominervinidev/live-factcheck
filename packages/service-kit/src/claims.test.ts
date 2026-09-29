import { describe, expect, it } from 'vitest';

import { normalizeClaimText } from './claims.js';

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
