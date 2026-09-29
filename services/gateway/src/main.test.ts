import { fileURLToPath } from 'node:url';

import { jsonLines, startServiceProcess } from '@lfc/service-kit/testing';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));

describe('gateway startup', () => {
  it('exits 1 with a clear message naming every missing required variable', async () => {
    const run = startServiceProcess(ENTRY, { PORT: '8080' });
    expect(await run.exitCode).toBe(1);

    const fatal = jsonLines(run.output()).find((line) => line['level'] === 'fatal');
    expect(fatal).toMatchObject({ service: 'gateway', msg: 'invalid configuration, exiting' });
    const issues = (fatal?.['issues'] ?? []) as string[];
    expect(issues.map((issue) => issue.split(':')[0])).toEqual([
      'REDIS_URL',
      'REDIS_PASSWORD',
      'GATEWAY_TOKEN',
      'TRANSCRIPTION_URL',
    ]);
  });

  it('rejects a REDIS_URL that is not a redis URL', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'http://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      GATEWAY_TOKEN: 't'.repeat(32),
      TRANSCRIPTION_URL: 'ws://transcription:8080/v1/audio',
    });
    expect(await run.exitCode).toBe(1);
    expect(run.output()).toContain('REDIS_URL');
  });

  it('rejects a gateway token shorter than 32 characters without printing it', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'redis://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      GATEWAY_TOKEN: 'short-token-value',
      TRANSCRIPTION_URL: 'ws://transcription:8080/v1/audio',
    });
    expect(await run.exitCode).toBe(1);
    expect(run.output()).toContain('GATEWAY_TOKEN');
    expect(run.output()).not.toContain('short-token-value');
  });
});
