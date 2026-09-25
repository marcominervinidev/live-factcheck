import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { freePort, jsonLines, startServiceProcess } from '@lfc/service-kit/testing';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));

const fatalIssues = (output: string) => {
  const fatal = jsonLines(output).find((line) => line['level'] === 'fatal');
  expect(fatal).toMatchObject({
    service: 'fact-checker',
    msg: 'invalid configuration, exiting',
  });
  return (fatal?.['issues'] ?? []) as string[];
};

describe('fact-checker startup', () => {
  it('exits 1 with a clear message naming every missing required variable', async () => {
    const run = startServiceProcess(ENTRY, { PORT: '8080' });
    expect(await run.exitCode).toBe(1);

    const issues = fatalIssues(run.output());
    expect(issues.map((issue) => issue.split(':')[0])).toEqual([
      'REDIS_URL',
      'REDIS_PASSWORD',
      'CHECKER_LLM_PROVIDER',
      'CHECKER_LLM_MODEL',
    ]);
  });

  it('rejects a REDIS_URL that is not a redis URL', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'http://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      CHECKER_LLM_PROVIDER: 'mock',
      CHECKER_LLM_MODEL: 'mock',
    });
    expect(await run.exitCode).toBe(1);
    expect(run.output()).toContain('REDIS_URL');
  });

  it('requires an API key when the provider is anthropic', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'redis://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      CHECKER_LLM_PROVIDER: 'anthropic',
      CHECKER_LLM_MODEL: 'some-model',
    });
    expect(await run.exitCode).toBe(1);
    expect(fatalIssues(run.output())).toContain(
      'CHECKER_LLM_API_KEY: required when CHECKER_LLM_PROVIDER=anthropic',
    );
  });

  it('never writes the configured API key to any log line (DoD)', async () => {
    const apiKey = `sk-ant-test-${randomBytes(16).toString('hex')}`;
    const run = startServiceProcess(ENTRY, {
      PORT: String(await freePort()),
      REDIS_URL: `redis://127.0.0.1:${String(await freePort())}`,
      REDIS_PASSWORD: 'x'.repeat(16),
      CHECKER_LLM_PROVIDER: 'anthropic',
      CHECKER_LLM_MODEL: 'some-model',
      CHECKER_LLM_API_KEY: apiKey,
    });
    await run.waitFor('service started');
    run.kill('SIGTERM');
    await run.exitCode;

    expect(run.output()).toContain('"provider":"anthropic"');
    expect(run.output()).not.toContain(apiKey);
    const lines = run.output().split('\n');
    expect(lines.filter((line) => line.includes(apiKey))).toEqual([]);
  });
});
