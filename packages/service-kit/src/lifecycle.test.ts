import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { freePort, jsonLines, startServiceProcess } from './testing/process.js';

const FIXTURE = fileURLToPath(new URL('./testing/fixture-service.ts', import.meta.url));
const startFixture = (env: Record<string, string>) => startServiceProcess(FIXTURE, env);

describe('runService', () => {
  it('exits 1 with a clear JSON log line when required config is missing', async () => {
    const run = startFixture({});
    expect(await run.exitCode).toBe(1);
    const fatal = jsonLines(run.output()).find((line) => line['level'] === 'fatal');
    expect(fatal).toMatchObject({ service: 'fixture', msg: 'invalid configuration, exiting' });
    const issues = fatal?.['issues'] as string[];
    expect(issues.some((issue) => issue.startsWith('PORT:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('FIXTURE_API_KEY:'))).toBe(true);
  });

  it('serves /healthz and shuts down cleanly on SIGTERM', async () => {
    const port = await freePort();
    const run = startFixture({ PORT: String(port), FIXTURE_API_KEY: 'k'.repeat(16) });
    await run.waitFor('service started');

    const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
    expect(response.status).toBe(200);

    run.kill('SIGTERM');
    expect(await run.exitCode).toBe(0);
    const messages = jsonLines(run.output()).map((line) => line['msg']);
    expect(messages).toEqual(
      expect.arrayContaining(['shutting down', 'fixture stopped', 'shutdown complete']),
    );
  });

  it('never writes the configured API key to any output line', async () => {
    const port = await freePort();
    const key = `sk-test-${randomBytes(16).toString('hex')}`;
    const run = startFixture({ PORT: String(port), FIXTURE_API_KEY: key });
    await run.waitFor('service started');
    run.kill('SIGTERM');
    await run.exitCode;

    expect(run.output()).toContain('fixture configured');
    expect(run.output()).not.toContain(key);
  });
});
