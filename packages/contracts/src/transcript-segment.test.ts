import { describe, expect, it } from 'vitest';

import { validSegment } from './testing/fixtures.js';
import { TranscriptSegment } from './transcript-segment.js';

const failurePaths = (input: unknown) =>
  TranscriptSegment.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

describe('TranscriptSegment contract', () => {
  it('accepts a valid final segment', () => {
    expect(TranscriptSegment.parse(validSegment())).toEqual(validSegment());
  });

  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['sessionId', { sessionId: 'not-a-uuid' }],
    ['speaker', { speaker: '' }],
    ['text', { text: '   ' }],
    ['startMs', { startMs: -1 }],
    ['startMs', { startMs: 1.5 }],
    ['language', { language: 'german' }],
    ['endMs', { startMs: 5_000, endMs: 4_000 }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validSegment(), ...override })).toContain(path);
  });

  it('rejects unknown fields instead of dropping them', () => {
    const result = TranscriptSegment.safeParse({ ...validSegment(), confidence: 0.9 });
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('rejects a missing required field', () => {
    const { language: _language, ...withoutLanguage } = validSegment();
    expect(failurePaths(withoutLanguage)).toContain('language');
  });
});
