import { describe, expect, it } from 'vitest';

import { ApiError, CheckClaimAccepted, CheckClaimRequest, ProviderStatus } from './api.js';
import { CLAIM_ID, SESSION_ID } from './testing/fixtures.js';

const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('CheckClaimRequest v1', () => {
  const valid = {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    text: 'Berlin hat 3,9 Millionen Einwohner.',
  };

  it('accepts a typed claim for an open session', () => {
    expect(CheckClaimRequest.parse(valid)).toEqual(valid);
  });

  it.each([
    ['text', { text: '   ' }],
    ['text', { text: 'x'.repeat(1_001) }],
    ['sessionId', { sessionId: 'abc' }],
    ['schemaVersion', { schemaVersion: 2 }],
  ])('rejects an invalid %s', (path, override) => {
    expect(paths(CheckClaimRequest.safeParse({ ...valid, ...override }))).toContain(path);
  });

  it('rejects extra fields such as a token in the body', () => {
    expect(CheckClaimRequest.safeParse({ ...valid, token: 'x' }).success).toBe(false);
  });
});

describe('CheckClaimAccepted v1', () => {
  it('accepts session and claim id', () => {
    const accepted = { schemaVersion: 1, sessionId: SESSION_ID, claimId: CLAIM_ID };
    expect(CheckClaimAccepted.parse(accepted)).toEqual(accepted);
    expect(CheckClaimAccepted.safeParse({ ...accepted, claimId: '' }).success).toBe(false);
  });
});

describe('ProviderStatus v1', () => {
  const valid = {
    schemaVersion: 1,
    privacyMode: 'cloud',
    providers: [
      {
        service: 'fact-checker',
        role: 'classifier',
        provider: 'typesafe',
        model: 'jev-1.13.0',
        cloud: true,
      },
      { service: 'fact-checker', role: 'search', provider: 'searxng', cloud: false },
    ],
  };

  it('accepts the providers with their cloud flag', () => {
    expect(ProviderStatus.parse(valid)).toEqual(valid);
  });

  it.each([
    ['privacyMode', { privacyMode: 'offline' }],
    ['providers.0.role', { providers: [{ ...valid.providers[0], role: 'stt-secret' }] }],
    ['providers.0.cloud', { providers: [{ ...valid.providers[0], cloud: 'yes' }] }],
  ])('rejects an invalid %s', (path, override) => {
    expect(paths(ProviderStatus.safeParse({ ...valid, ...override }))).toContain(path);
  });

  it('has no place for keys or base URLs', () => {
    const withKey = { ...valid, providers: [{ ...valid.providers[0], apiKey: 'sk-ant-x' }] };
    expect(ProviderStatus.safeParse(withKey).success).toBe(false);
  });
});

describe('ApiError v1', () => {
  it('accepts a known code with a message', () => {
    const error = {
      schemaVersion: 1,
      error: { code: 'rate_limited', message: 'Too many requests' },
    };
    expect(ApiError.parse(error)).toEqual(error);
  });

  it('rejects unknown codes and extra detail fields', () => {
    expect(
      ApiError.safeParse({ schemaVersion: 1, error: { code: 'teapot', message: 'x' } }).success,
    ).toBe(false);
    expect(
      ApiError.safeParse({
        schemaVersion: 1,
        error: { code: 'internal', message: 'x', stack: 'at …' },
      }).success,
    ).toBe(false);
  });
});
