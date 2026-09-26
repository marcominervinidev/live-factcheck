import { expect, test } from '@playwright/test';

// The public edge (Caddy): TLS, security headers, redirect and routing (brief 15.4, 15.5).
test('serves the app over HTTPS with the security headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);

  const headers = response.headers();
  expect(headers['strict-transport-security']).toBe('max-age=31536000');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("script-src 'self';");
  expect(headers['permissions-policy']).toContain('microphone=(self)');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['server']).toBeUndefined();
});

test('redirects plain HTTP to HTTPS on the default port', async ({ request, baseURL }) => {
  const host = new URL(baseURL ?? '').hostname;
  const response = await request.get(`http://${host}:8080/some/path?x=1`, { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toBe(`https://${host}/some/path?x=1`);
});

test('serves the runtime config without caching and without secrets', async ({ request }) => {
  const response = await request.get('/config.json');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ gatewayUrl: '/api' });
});

test('routes /api to the gateway', async ({ request }) => {
  const response = await request.get('/api/unknown');
  expect(response.status()).toBe(404);
  // Fastify's JSON 404, not nginx' HTML page: the request reached the gateway.
  expect(response.headers()['content-type']).toContain('application/json');
});

test('sends no CORS headers, so cross-origin browser calls are blocked', async ({ request }) => {
  const response = await request.get('/api/unknown', {
    headers: { Origin: 'https://evil.example' },
  });
  expect(response.headers()['access-control-allow-origin']).toBeUndefined();
});
