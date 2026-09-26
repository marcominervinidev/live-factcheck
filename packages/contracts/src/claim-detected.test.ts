import { describe, expect, it } from 'vitest';

import { ClaimDetected } from './claim-detected.js';
import { validDetected, validTextModeDetected } from './testing/fixtures.js';

const failurePaths = (input: unknown) =>
  ClaimDetected.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

describe('ClaimDetected v2 contract', () => {
  it('accepts a claim from the transcript with a resolved standalone wording', () => {
    expect(ClaimDetected.parse(validDetected())).toEqual(validDetected());
  });

  it('accepts a text-mode claim without source segments', () => {
    expect(ClaimDetected.parse(validTextModeDetected())).toEqual(validTextModeDetected());
  });

  it.each([
    ['schemaVersion', { schemaVersion: 1 }],
    ['claimId', { claimId: '123' }],
    ['originalText', { originalText: ' ' }],
    ['standaloneText', { standaloneText: 'x'.repeat(1_001) }],
    ['normalizedText', { normalizedText: '' }],
    ['checkworthiness', { checkworthiness: 1.01 }],
    ['checkworthiness', { checkworthiness: -0.1 }],
    ['checkworthiness', { checkworthiness: '0.9' }],
    ['sourceSegmentIds.0', { sourceSegmentIds: ['nope'] }],
    ['detectedAt', { detectedAt: '2026-09-25 10:00' }],
    ['detectedAt', { detectedAt: '2026-09-25T12:00:00+02:00' }],
    ['provider.classifier', { provider: { classifier: '', model: 'm' } }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validDetected(), ...override })).toContain(path);
  });

  it('rejects the removed v1 field `text` and other unknown fields', () => {
    expect(ClaimDetected.safeParse({ ...validDetected(), text: 'x' }).success).toBe(false);
    expect(
      ClaimDetected.safeParse({
        ...validDetected(),
        provider: { classifier: 'llm', model: 'm', key: 'k' },
      }).success,
    ).toBe(false);
  });

  it.each(['provider', 'standaloneText', 'checkworthiness'] as const)('requires %s', (field) => {
    const { [field]: _removed, ...rest } = validDetected();
    expect(failurePaths(rest)).toContain(field);
  });
});
