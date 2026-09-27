import { expect, test } from '@playwright/test';

// Operational endpoints of every Node service, reached directly on the internal network.
const SERVICES = ['gateway', 'transcription', 'claim-extractor', 'fact-checker'] as const;

for (const service of SERVICES) {
  test.describe(service, () => {
    const base = `http://${service}:8080`;

    test('is alive and ready with its Redis dependency', async ({ request }) => {
      const health = await request.get(`${base}/healthz`);
      expect(health.status()).toBe(200);

      const ready = await request.get(`${base}/readyz`);
      expect(ready.status()).toBe(200);
      expect(await ready.json()).toEqual({ status: 'ready', checks: { redis: 'ok' } });
    });

    test('exposes Prometheus metrics labelled with the service name', async ({ request }) => {
      const metrics = await request.get(`${base}/metrics`);
      expect(metrics.status()).toBe(200);
      expect(metrics.headers()['content-type']).toContain('text/plain');
      expect(await metrics.text()).toContain(
        `process_cpu_user_seconds_total{service="${service}"}`,
      );
    });

    test('answers unknown routes with 404 and no stack trace', async ({ request }) => {
      const response = await request.get(`${base}/does-not-exist`);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toMatch(/at \w+ \(|node_modules/);
    });
  });
}
