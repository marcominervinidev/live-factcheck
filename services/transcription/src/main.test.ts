import { fileURLToPath } from 'node:url';

import { jsonLines, startServiceProcess } from '@lfc/service-kit/testing';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));

// Child-process starts need headroom when measurement or stack builds saturate the CPU
// (several hook runs broke the default 20 s on 2026-09-30/10-01); assertions unchanged.
describe('transcription startup', { timeout: 60_000 }, () => {
  it('exits 1 with a clear message naming every missing required variable', async () => {
    const run = startServiceProcess(ENTRY, { PORT: '8080' });
    expect(await run.exitCode).toBe(1);

    const fatal = jsonLines(run.output()).find((line) => line['level'] === 'fatal');
    expect(fatal).toMatchObject({
      service: 'transcription',
      msg: 'invalid configuration, exiting',
    });
    const issues = (fatal?.['issues'] ?? []) as string[];
    expect(issues.map((issue) => issue.split(':')[0])).toEqual([
      'REDIS_URL',
      'REDIS_PASSWORD',
      'STT_PROVIDER',
      'STT_MODEL',
    ]);
  });

  it('rejects a REDIS_URL that is not a redis URL', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'http://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      STT_PROVIDER: 'mock',
      STT_MODEL: 'mock',
    });
    expect(await run.exitCode).toBe(1);
    expect(run.output()).toContain('REDIS_URL');
  });

  it('never writes a configured STT key to any log line', async () => {
    const key = 'dg-test-key-never-logged-in-transcription';
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'redis://127.0.0.1:1',
      REDIS_PASSWORD: 'x'.repeat(16),
      STT_PROVIDER: 'deepgram',
      STT_MODEL: 'nova-3',
      DEEPGRAM_API_KEY: key,
    });
    await run.waitFor('providers');
    run.kill('SIGTERM');
    await run.exitCode;
    expect(run.output()).toContain('"provider":"deepgram"');
    expect(run.output()).not.toContain(key);
  });
});
