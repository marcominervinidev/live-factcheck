import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadClaims, loadDetection } from './dataset.js';

const FILE = new URL('../claims.de.jsonl', import.meta.url).pathname;

/** The `sourceId`s with a row in SOURCES.md: every item must name one of them (brief 13.5). */
const DOCUMENTED_SOURCES = new Set(
  [
    ...readFileSync(new URL('../SOURCES.md', import.meta.url), 'utf8').matchAll(
      /^\| `([a-z0-9-]+)` \|/gm,
    ),
  ].map((match) => match[1]),
);

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

describe('detection.de.jsonl', () => {
  const items = loadDetection(new URL('../detection.de.jsonl', import.meta.url).pathname);

  it('has about 150 segments with both labels, from a documented source (ADR 0017)', () => {
    expect(items.length).toBeGreaterThanOrEqual(150);
    const positives = items.filter((i) => i.expected).length;
    expect(positives).toBeGreaterThanOrEqual(30);
    expect(items.length - positives).toBeGreaterThanOrEqual(100);
    expect(items.filter((i) => !DOCUMENTED_SOURCES.has(i.sourceId)).map((i) => i.id)).toEqual([]);
  });

  it('keeps the segments of one conversation together, so the replay order is the file order', () => {
    const seen: string[] = [];
    for (const { conversationId } of items)
      if (seen.at(-1) !== conversationId) seen.push(conversationId);
    expect(seen).toEqual([...new Set(seen)]);
  });
});

describe('loadDetection', () => {
  it('rejects a speaker name instead of a letter (brief 15.6)', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'lfc-evals-')), 'detection.jsonl');
    writeFileSync(
      path,
      JSON.stringify({
        id: 'a',
        conversationId: 'c',
        speaker: 'Merz',
        text: 'Satz.',
        expected: false,
        sourceId: 'test',
        note: 'n',
        reviewed: true,
      }),
    );
    expect(() => loadDetection(path)).toThrow(`${path}:1: speaker`);
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
