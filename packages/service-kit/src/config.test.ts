import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConfigError, baseConfigSchema, loadConfig } from './config.js';

const schema = baseConfigSchema.extend({
  REDIS_URL: z.url(),
  REDIS_PASSWORD: z.string().min(1),
});
const secretKeys = ['REDIS_PASSWORD'] as const;

const validEnv = { PORT: '8080', REDIS_URL: 'redis://redis:6379', REDIS_PASSWORD: 's3cret-value' };

function loadIssues(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(schema, { secretKeys, env });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lfc-config-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses and coerces a valid environment and applies base defaults', () => {
    const { config } = loadConfig(schema, { secretKeys, env: validEnv });
    expect(config).toEqual({
      PORT: 8080,
      LOG_LEVEL: 'info',
      SHUTDOWN_TIMEOUT_MS: 10_000,
      REDIS_URL: 'redis://redis:6379',
      REDIS_PASSWORD: 's3cret-value',
    });
  });

  it('reads a secret from <KEY>_FILE and trims the trailing newline', () => {
    const file = join(dir, 'redis_password');
    writeFileSync(file, 'from-file-secret\n');
    const { REDIS_PASSWORD: _password, ...env } = validEnv;
    const loaded = loadConfig(schema, { secretKeys, env: { ...env, REDIS_PASSWORD_FILE: file } });
    expect(loaded.config.REDIS_PASSWORD).toBe('from-file-secret');
    expect(loaded.secretValues).toEqual(['from-file-secret']);
  });

  it('rejects a secret given both directly and as file', () => {
    const file = join(dir, 'redis_password');
    writeFileSync(file, 'x');
    expect(loadIssues({ ...validEnv, REDIS_PASSWORD_FILE: file })).toEqual([
      'REDIS_PASSWORD: set either REDIS_PASSWORD or REDIS_PASSWORD_FILE, not both',
    ]);
  });

  it('reports an unreadable secret file by path, not by content', () => {
    const { REDIS_PASSWORD: _password, ...env } = validEnv;
    const missing = join(dir, 'missing');
    expect(loadIssues({ ...env, REDIS_PASSWORD_FILE: missing })).toContain(
      `REDIS_PASSWORD_FILE: cannot read secret file ${missing}`,
    );
  });

  it('treats an empty secret file as missing', () => {
    const file = join(dir, 'empty');
    writeFileSync(file, '\n');
    const { REDIS_PASSWORD: _password, ...env } = validEnv;
    const issues = loadIssues({ ...env, REDIS_PASSWORD_FILE: file });
    expect(issues.some((issue) => issue.startsWith('REDIS_PASSWORD:'))).toBe(true);
  });

  it('lists every problem at once and never echoes values', () => {
    const issues = loadIssues({ PORT: 'eighty', REDIS_PASSWORD: 'leaky-value-123' });
    expect(issues.map((issue) => issue.split(':')[0])).toEqual(['PORT', 'REDIS_URL']);
    expect(issues.join('\n')).not.toContain('eighty');
    expect(issues.join('\n')).not.toContain('leaky-value-123');
  });
});
