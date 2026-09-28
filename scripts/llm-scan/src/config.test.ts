import { describe, expect, it } from 'vitest';

import { Config } from './config.js';

const LOCAL = {
  SCAN_LLM_PROVIDER: 'openai-compatible',
  SCAN_LLM_MODEL: 'qwen2.5-coder-7b-instruct',
  SCAN_LLM_BASE_URL: 'http://host.docker.internal:1234/v1',
};

const providerIssues = (env: Record<string, string>) =>
  (Config.safeParse(env).error?.issues ?? []).filter((i) => i.path[0] === 'SCAN_LLM_PROVIDER');

describe('Config', () => {
  it('accepts a local model and defaults the base ref', () => {
    const parsed = Config.parse(LOCAL);
    expect(parsed.LLM_SCAN_BASE_REF).toBe('origin/main');
  });

  it.each([
    ['a cloud provider', { ...LOCAL, SCAN_LLM_PROVIDER: 'anthropic', SCAN_LLM_API_KEY: 'k' }],
    ['a cloud endpoint', { ...LOCAL, SCAN_LLM_BASE_URL: 'https://api.example.com/v1' }],
  ])('refuses %s, so source code never leaves the machine', (_, env) => {
    expect(providerIssues(env).map((i) => i.message)).toContain(
      'only a local model may read the source code (LM Studio/Ollama, ADR 0014)',
    );
  });

  it('refuses a base ref git could read as an option', () => {
    expect(Config.safeParse({ ...LOCAL, LLM_SCAN_BASE_REF: '--output=x' }).success).toBe(false);
  });
});
