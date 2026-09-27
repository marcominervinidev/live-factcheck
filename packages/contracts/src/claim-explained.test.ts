import { describe, expect, it } from 'vitest';

import { ClaimExplained, countSentences } from './claim-explained.js';
import { validExplained } from './testing/fixtures.js';

const failurePaths = (input: unknown) =>
  ClaimExplained.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

describe('ClaimExplained v1 contract', () => {
  it('accepts the explanation from the brief example', () => {
    expect(ClaimExplained.parse(validExplained())).toEqual(validExplained());
  });

  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['claimId', { claimId: 'claim-1' }],
    ['explanation', { explanation: 'Eins ist falsch. Zwei ist falsch. Drei ist falsch.' }],
    ['explanation', { explanation: 'x'.repeat(401) }],
    ['explanation', { explanation: '  ' }],
    ['provider.model', { provider: { llm: 'anthropic', model: '' } }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validExplained(), ...override })).toContain(path);
  });

  it('rejects unknown fields', () => {
    expect(ClaimExplained.safeParse({ ...validExplained(), verdict: 'falsch' }).success).toBe(
      false,
    );
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
