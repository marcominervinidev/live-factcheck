import { describe, expect, it } from 'vitest';

import { configSchema } from './config.js';
import { MOCK_CONFIG_ENV } from './testing/mock-env.js';

const issuePaths = (env: Record<string, string>) => {
  const result = configSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('fact-checker config', () => {
  it('accepts an all-mock setup and fills the research defaults', () => {
    const config = configSchema.parse(MOCK_CONFIG_ENV);
    expect(config).toMatchObject({
      PRIVACY_MODE: 'cloud',
      CHECKER_FETCH_TIMEOUT_MS: 8_000,
      CHECKER_FETCH_MAX_BYTES: 2_000_000,
      CHECKER_WEB_PAGES: 4,
      CHECKER_TOP_K: 6,
      CHECKER_VERDICT_CACHE_TTL_S: 7 * 24 * 3600,
    });
  });

  it('caps the page size (jsdom parses synchronously) and the page and chunk counts', () => {
    expect(
      issuePaths({
        ...MOCK_CONFIG_ENV,
        CHECKER_FETCH_MAX_BYTES: '5000001',
        CHECKER_WEB_PAGES: '11',
        CHECKER_TOP_K: '0',
      }),
    ).toEqual(['CHECKER_FETCH_MAX_BYTES', 'CHECKER_WEB_PAGES', 'CHECKER_TOP_K']);
  });

  it('bounds the check time budget (default 60 s, raised for slow local models)', () => {
    expect(configSchema.parse(MOCK_CONFIG_ENV).CHECKER_TIMEOUT_MS).toBe(60_000);
    expect(
      configSchema.parse({ ...MOCK_CONFIG_ENV, CHECKER_TIMEOUT_MS: '300000' }).CHECKER_TIMEOUT_MS,
    ).toBe(300_000);
    expect(issuePaths({ ...MOCK_CONFIG_ENV, CHECKER_TIMEOUT_MS: '600001' })).toEqual([
      'CHECKER_TIMEOUT_MS',
    ]);
    expect(issuePaths({ ...MOCK_CONFIG_ENV, CHECKER_TIMEOUT_MS: '999' })).toEqual([
      'CHECKER_TIMEOUT_MS',
    ]);
  });

  it('requires an https contact URL for the User-Agent', () => {
    expect(
      issuePaths({ ...MOCK_CONFIG_ENV, CHECKER_USER_AGENT_URL: 'http://example.org' }),
    ).toEqual(['CHECKER_USER_AGENT_URL']);
  });

  it('refuses the Google Fact Check tier in local privacy mode, but not with mock sources', () => {
    const live = {
      ...MOCK_CONFIG_ENV,
      PRIVACY_MODE: 'local',
      CHECKER_RESEARCH_SOURCES: 'live',
      GOOGLE_FACTCHECK_API_KEY: 'k'.repeat(20),
    };
    const result = configSchema.safeParse(live);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      'CHECKER_RESEARCH_SOURCES=live with GOOGLE_FACTCHECK_API_KEY',
    );
    // The error names the setting, never the key.
    expect(JSON.stringify(result.error?.issues)).not.toContain('k'.repeat(20));

    expect(issuePaths({ ...live, CHECKER_RESEARCH_SOURCES: 'mock' })).toEqual([]);
  });

  it('refuses a cloud LLM in local privacy mode', () => {
    expect(
      configSchema.safeParse({
        ...MOCK_CONFIG_ENV,
        PRIVACY_MODE: 'local',
        CHECKER_LLM_PROVIDER: 'anthropic',
        CHECKER_LLM_MODEL: 'claude-opus-5',
        CHECKER_LLM_API_KEY: 'k'.repeat(20),
      }).success,
    ).toBe(false);
  });
});
