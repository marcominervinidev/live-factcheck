import { describe, expect, it } from 'vitest';

import { loadClaims } from './dataset.js';

const FILE = new URL('../claims.de.jsonl', import.meta.url).pathname;

describe('claims.de.jsonl', () => {
  const items = loadClaims(FILE);

  it('is valid, with unique ids and every verdict represented', () => {
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(new Set(items.map((i) => i.expected))).toEqual(
      new Set(['stimmt', 'groesstenteils_richtig', 'uebertrieben', 'falsch', 'nicht_pruefbar']),
    );
  });

  it('has a numeric/date slice to watch the known classifier weakness (brief 8.1)', () => {
    expect(
      items.filter((i) => i.category === 'zahl' || i.category === 'datum').length,
    ).toBeGreaterThanOrEqual(15);
  });

  it('names a documented source for every item', () => {
    expect([...new Set(items.map((i) => i.sourceId))]).toEqual(['agent-seed']);
  });
});
