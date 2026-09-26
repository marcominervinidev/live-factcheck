import { describe, expect, it } from 'vitest';

import { validTopic } from './testing/fixtures.js';
import { TopicDetected } from './topic-detected.js';

const failurePaths = (input: unknown) =>
  TopicDetected.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

describe('TopicDetected v1 contract', () => {
  it('accepts a topic with keywords', () => {
    expect(TopicDetected.parse(validTopic())).toEqual(validTopic());
  });

  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['topicId', { topicId: 'ww2' }],
    ['label', { label: '' }],
    ['label', { label: 'x'.repeat(121) }],
    ['keywords.0', { keywords: [' '] }],
    ['keywords', { keywords: Array.from({ length: 21 }, (_, i) => `k${String(i)}`) }],
    ['detectedAt', { detectedAt: 'gestern' }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validTopic(), ...override })).toContain(path);
  });
});
