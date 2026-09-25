import { describe, expect, it } from 'vitest';

import { ClaimChecked, countSentences } from './claim-checked.js';
import { validChecked } from './testing/fixtures.js';

const failurePaths = (input: unknown) =>
  ClaimChecked.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

describe('ClaimChecked contract', () => {
  it('accepts the example verdict from the brief', () => {
    expect(ClaimChecked.parse(validChecked())).toEqual(validChecked());
  });

  it('accepts a source without snippet', () => {
    const [source] = validChecked().sources;
    const withoutSnippet = { title: source?.title, url: source?.url };
    expect(ClaimChecked.safeParse({ ...validChecked(), sources: [withoutSnippet] }).success).toBe(
      true,
    );
  });

  it('accepts nicht_pruefbar without sources', () => {
    const input = { ...validChecked(), verdict: 'nicht_pruefbar', sources: [] };
    expect(ClaimChecked.safeParse(input).success).toBe(true);
  });

  it('rejects any other verdict without sources', () => {
    expect(failurePaths({ ...validChecked(), sources: [] })).toContain('sources');
  });

  it.each([
    ['verdict', { verdict: 'wahr' }],
    ['confidence', { confidence: 0.8 }],
    ['explanation', { explanation: 'Eins ist falsch. Zwei ist falsch. Drei ist falsch.' }],
    ['explanation', { explanation: 'x'.repeat(401) }],
    ['sources.0.url', { sources: [{ title: 'Datei', url: 'file:///etc/passwd' }] }],
    ['sources.0.url', { sources: [{ title: 'Relativ', url: '/wiki/Krieg' }] }],
    ['provider.model', { provider: { llm: 'anthropic', model: '', search: 'searxng' } }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validChecked(), ...override })).toContain(path);
  });
});

describe('countSentences', () => {
  it.each([
    ['Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.', 1],
    ['Das stimmt nicht. Die Zahl ist höher.', 2],
    ['Er endete am 8. Mai 1945 in Europa.', 1],
    ['Das gilt z. B. für Berlin. Außerdem für Hamburg.', 2],
    ['Eins. Zwei. Drei.', 3],
    ['Stimmt das? Nein!', 2],
  ])('counts %j as %i', (value, expected) => {
    expect(countSentences(value)).toBe(expected);
  });
});
