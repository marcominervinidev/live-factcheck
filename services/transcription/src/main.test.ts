import { fileURLToPath } from 'node:url';

import { jsonLines, startServiceProcess } from '@lfc/service-kit/testing';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));

describe('transcription startup', () => {
  it('exits 1 with a clear message naming every missing required variable', async () => {
    const run = startServiceProcess(ENTRY, { PORT: '8080' });
    expect(await run.exitCode).toBe(1);

    const fatal = jsonLines(run.output()).find((line) => line['level'] === 'fatal');
    expect(fatal).toMatchObject({
      service: 'transcription',
      msg: 'invalid configuration, exiting',
    });
    const issues = (fatal?.['issues'] ?? []) as string[];
    expect(issues.map((issue) => issue.split(':')[0])).toEqual(['REDIS_URL', 'REDIS_PASSWORD']);
  });

  it('rejects a REDIS_URL that is not a redis URL', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'http://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
    });
    expect(await run.exitCode).toBe(1);
    expect(run.output()).toContain('REDIS_URL');
  });
});
