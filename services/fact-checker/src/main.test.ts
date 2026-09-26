import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { freePort, jsonLines, startServiceProcess } from '@lfc/service-kit/testing';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const SOURCE_TIERS_FILE = fileURLToPath(
  new URL('../../../config/source-tiers.yaml', import.meta.url),
);

/** Everything except Redis and the LLM/classifier, set to local mocks. */
const MOCK_ENV = {
  SEARCH_PROVIDER: 'mock',
  EMBEDDINGS_PROVIDER: 'mock',
  EMBEDDINGS_MODEL: 'mock',
  CHECKER_RESEARCH_SOURCES: 'mock',
  SOURCE_TIERS_FILE,
  CHECKER_USER_AGENT_URL: 'https://github.com/marcominervinidev/live-factcheck',
};

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
      'CHECKER_CLASSIFIER_PROVIDER',
      'SEARCH_PROVIDER',
      'EMBEDDINGS_PROVIDER',
      'EMBEDDINGS_MODEL',
      'CHECKER_RESEARCH_SOURCES',
      'SOURCE_TIERS_FILE',
      'CHECKER_USER_AGENT_URL',
    ]);
  });

  it('rejects a REDIS_URL that is not a redis URL', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'http://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      CHECKER_LLM_PROVIDER: 'mock',
      CHECKER_LLM_MODEL: 'mock',
      CHECKER_CLASSIFIER_PROVIDER: 'mock',
      ...MOCK_ENV,
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
      CHECKER_CLASSIFIER_PROVIDER: 'mock',
      ...MOCK_ENV,
    });
    expect(await run.exitCode).toBe(1);
    expect(fatalIssues(run.output())).toContain(
      'CHECKER_LLM_API_KEY: required when CHECKER_LLM_PROVIDER=anthropic',
    );
  });

  it('refuses cloud providers when PRIVACY_MODE=local (brief 15.6)', async () => {
    const run = startServiceProcess(ENTRY, {
      PORT: '8080',
      REDIS_URL: 'redis://redis:6379',
      REDIS_PASSWORD: 'x'.repeat(16),
      PRIVACY_MODE: 'local',
      CHECKER_LLM_PROVIDER: 'openai-compatible',
      CHECKER_LLM_MODEL: 'qwen',
      CHECKER_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
      CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
      CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
      TYPESAFE_API_KEY: 'ts-key',
      ...MOCK_ENV,
      CHECKER_RESEARCH_SOURCES: 'live',
      GOOGLE_FACTCHECK_API_KEY: 'goog-key',
    });
    expect(await run.exitCode).toBe(1);
    expect(fatalIssues(run.output())).toEqual([
      'PRIVACY_MODE: CHECKER_CLASSIFIER_PROVIDER=typesafe sends data to a cloud service; not allowed when PRIVACY_MODE=local',
      'PRIVACY_MODE: CHECKER_RESEARCH_SOURCES=live with GOOGLE_FACTCHECK_API_KEY sends data to a cloud service; not allowed when PRIVACY_MODE=local',
    ]);
  });

  it('never writes the configured API keys to any log line (DoD)', async () => {
    const apiKey = `sk-ant-test-${randomBytes(16).toString('hex')}`;
    const typesafeKey = `ts-test-${randomBytes(16).toString('hex')}`;
    const googleKey = `goog-test-${randomBytes(16).toString('hex')}`;
    const run = startServiceProcess(ENTRY, {
      PORT: String(await freePort()),
      REDIS_URL: `redis://127.0.0.1:${String(await freePort())}`,
      REDIS_PASSWORD: 'x'.repeat(16),
      CHECKER_LLM_PROVIDER: 'anthropic',
      CHECKER_LLM_MODEL: 'some-model',
      CHECKER_LLM_API_KEY: apiKey,
      CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
      CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
      TYPESAFE_API_KEY: typesafeKey,
      ...MOCK_ENV,
      CHECKER_RESEARCH_SOURCES: 'live',
      GOOGLE_FACTCHECK_API_KEY: googleKey,
    });
    await run.waitFor('service started');
    run.kill('SIGTERM');
    await run.exitCode;

    expect(run.output()).toContain('"provider":"anthropic"');
    expect(run.output()).toContain('"provider":"typesafe"');
    expect(run.output()).toContain('"factCheckApi":true');
    const lines = run.output().split('\n');
    expect(
      lines.filter((line) => [apiKey, typesafeKey, googleKey].some((key) => line.includes(key))),
    ).toEqual([]);
  });
});
