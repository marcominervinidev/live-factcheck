import { describe, expect, it, vi } from 'vitest';

import { checkClaim, fetchProviderStatus } from './api';
import { CLAIM_ID, SESSION_ID } from './testing/fixtures';

const respond = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('checkClaim', () => {
  it('posts the claim with the token in the header, never in the URL', async () => {
    const fetchImpl = respond(202, { schemaVersion: 1, sessionId: SESSION_ID, claimId: CLAIM_ID });
    expect(await checkClaim('/api', 'secret-token', SESSION_ID, 'Text', fetchImpl)).toEqual({
      ok: true,
      claimId: CLAIM_ID,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/claims/check');
    expect(url).not.toContain('secret-token');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret-token');
    expect(JSON.parse(init.body as string)).toEqual({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      text: 'Text',
    });
  });

  it('returns the ApiError code, or internal for anything unexpected', async () => {
    const limited = respond(429, {
      schemaVersion: 1,
      error: { code: 'rate_limited', message: 'x' },
    });
    expect(await checkClaim('/api', 't', SESSION_ID, 'x', limited)).toEqual({
      ok: false,
      code: 'rate_limited',
    });
    const html = vi.fn(() => Promise.resolve(new Response('<html>', { status: 502 })));
    expect(await checkClaim('/api', 't', SESSION_ID, 'x', html)).toEqual({
      ok: false,
      code: 'internal',
    });
    const offline = vi.fn(() => Promise.reject(new TypeError('offline')));
    expect(await checkClaim('/api', 't', SESSION_ID, 'x', offline)).toEqual({
      ok: false,
      code: 'internal',
    });
  });
});

describe('fetchProviderStatus', () => {
  it('validates the status and returns null on errors', async () => {
    const body = {
      schemaVersion: 2,
      privacyMode: 'local',
      providers: [
        {
          service: 'fact-checker',
          role: 'llm',
          provider: 'openai-compatible',
          model: 'qwen',
          cloud: false,
        },
      ],
    };
    expect(await fetchProviderStatus('/api', 't', respond(200, body))).toEqual(body);
    expect(await fetchProviderStatus('/api', 't', respond(401, {}))).toBeNull();
    expect(await fetchProviderStatus('/api', 't', respond(200, { providers: 'x' }))).toBeNull();
  });
});
