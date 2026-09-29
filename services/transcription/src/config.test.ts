import { describe, expect, it } from 'vitest';

import { configSchema, secretKeys } from './config.js';

const base = { PORT: '8080', REDIS_URL: 'redis://redis:6379', REDIS_PASSWORD: 'x' };
const issues = (env: Record<string, string>) =>
  (configSchema.safeParse(env).error?.issues ?? []).map((i) => i.path.join('.'));

describe('transcription config (brief 10, 15.6; ADR 0016)', () => {
  it('needs Redis and an STT provider with its model', () => {
    expect(
      configSchema.safeParse({ ...base, STT_PROVIDER: 'mock', STT_MODEL: 'mock' }).success,
    ).toBe(true);
    expect(issues(base)).toEqual(['STT_PROVIDER', 'STT_MODEL']);
    expect(
      issues({ ...base, REDIS_URL: 'http://redis:6379', STT_PROVIDER: 'mock', STT_MODEL: 'm' }),
    ).toEqual(['REDIS_URL']);
  });

  it('requires the key of a cloud provider', () => {
    expect(issues({ ...base, STT_PROVIDER: 'deepgram', STT_MODEL: 'nova-3' })).toEqual([
      'DEEPGRAM_API_KEY',
    ]);
  });

  it('refuses cloud STT in local privacy mode but allows stt-local', () => {
    const cloud = {
      ...base,
      PRIVACY_MODE: 'local',
      STT_PROVIDER: 'deepgram',
      STT_MODEL: 'nova-3',
      DEEPGRAM_API_KEY: 'k',
    };
    expect(issues(cloud)).toEqual(['PRIVACY_MODE']);
    const local = {
      ...base,
      PRIVACY_MODE: 'local',
      STT_PROVIDER: 'local',
      STT_MODEL: 'small',
      LOCAL_STT_URL: 'ws://stt-local:8000/v1/stream',
    };
    expect(configSchema.safeParse(local).success).toBe(true);
  });

  it('knows only the Redis password and the STT keys as secrets (brief 15.1)', () => {
    expect(secretKeys).toEqual(['REDIS_PASSWORD', 'DEEPGRAM_API_KEY', 'ASSEMBLYAI_API_KEY']);
  });
});
