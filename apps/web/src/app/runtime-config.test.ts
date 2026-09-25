import { beforeEach, describe, expect, it } from 'vitest';

import { useRuntimeConfig } from './runtime-config';

// The backend is the system boundary of the frontend (brief 13.1): fetch is replaced, nothing else.
const respond =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('runtime config store', () => {
  beforeEach(() => {
    useRuntimeConfig.setState({ state: { status: 'idle' } });
  });

  it('loads a valid /config.json', async () => {
    await useRuntimeConfig.getState().load(respond(200, { gatewayUrl: '/api' }));
    expect(useRuntimeConfig.getState().state).toEqual({
      status: 'ready',
      config: { gatewayUrl: '/api' },
    });
  });

  it('accepts an absolute gateway URL', async () => {
    await useRuntimeConfig.getState().load(respond(200, { gatewayUrl: 'https://lfc.local/api' }));
    expect(useRuntimeConfig.getState().state.status).toBe('ready');
  });

  it.each([
    ['a missing field', {}],
    ['an unknown field', { gatewayUrl: '/api', apiKey: 'x' }],
    ['a relative path', { gatewayUrl: 'api' }],
    ['a javascript: URL', { gatewayUrl: 'javascript:alert(1)' }],
  ])('rejects %s', async (_label, body) => {
    await useRuntimeConfig.getState().load(respond(200, body));
    expect(useRuntimeConfig.getState().state).toEqual({
      status: 'error',
      reason: 'invalid config.json',
    });
  });

  it('reports HTTP errors', async () => {
    await useRuntimeConfig.getState().load(respond(404, {}));
    expect(useRuntimeConfig.getState().state).toEqual({ status: 'error', reason: 'HTTP 404' });
  });

  it('reports network errors', async () => {
    await useRuntimeConfig.getState().load(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(useRuntimeConfig.getState().state).toEqual({
      status: 'error',
      reason: 'Failed to fetch',
    });
  });
});
