import { describe, expect, it } from 'vitest';

import { ClaimDetected } from './claim-detected.js';
import { validDetected } from './testing/fixtures.js';

const failurePaths = (input: unknown) =>
  ClaimDetected.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

describe('ClaimDetected contract', () => {
  it('accepts a claim from the transcript', () => {
    expect(ClaimDetected.parse(validDetected())).toEqual(validDetected());
  });

  it('accepts a text-mode claim without source segments', () => {
    expect(ClaimDetected.safeParse({ ...validDetected(), sourceSegmentIds: [] }).success).toBe(
      true,
    );
  });

  it.each([
    ['claimId', { claimId: '123' }],
    ['normalizedText', { normalizedText: '' }],
    ['sourceSegmentIds.0', { sourceSegmentIds: ['nope'] }],
    ['detectedAt', { detectedAt: '2026-09-25 10:00' }],
    ['detectedAt', { detectedAt: '2026-09-25T12:00:00+02:00' }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validDetected(), ...override })).toContain(path);
  });

  it('rejects unknown fields', () => {
    expect(ClaimDetected.safeParse({ ...validDetected(), extra: true }).success).toBe(false);
  });
});
