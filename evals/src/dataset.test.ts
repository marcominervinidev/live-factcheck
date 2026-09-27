import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('loadClaims', () => {
  const line = (id: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id,
      claim: 'Der Zweite Weltkrieg endete 1945.',
      expected: 'stimmt',
      category: 'datum',
      sourceId: 'test',
      note: 'test',
      reviewed: true,
      ...extra,
    });
  const file = (content: string) => {
    const path = join(mkdtempSync(join(tmpdir(), 'lfc-evals-')), 'claims.jsonl');
    writeFileSync(path, content);
    return path;
  };

  it('skips blank lines', () => {
    expect(loadClaims(file(`${line('a')}\n\n${line('b')}\n`)).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('fails fast with file, line and field on an invalid item', () => {
    const path = file(`${line('a')}\n${line('b', { expected: 'vielleicht' })}\n`);
    expect(() => loadClaims(path)).toThrow(`${path}:2: expected`);
  });

  it('fails fast on a duplicate id', () => {
    const path = file(`${line('a')}\n${line('a')}\n`);
    expect(() => loadClaims(path)).toThrow(`${path}:2: duplicate id a`);
  });
});
