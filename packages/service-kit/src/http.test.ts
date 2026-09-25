import { Registry, collectDefaultMetrics } from 'prom-client';
import { describe, expect, it } from 'vitest';

import { createHttpServer } from './http.js';
import type { ReadinessCheck } from './http.js';
import { createLogger } from './logger.js';

function server(checks: readonly ReadinessCheck[], shuttingDown = false) {
  const lines: string[] = [];
  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics });
  const app = createHttpServer({
    logger: createLogger({
      service: 'test',
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    }),
    metrics,
    readiness: () => checks,
    isShuttingDown: () => shuttingDown,
    readinessTimeoutMs: 50,
  });
  return { app, lines };
}

const ok: ReadinessCheck = { name: 'redis', check: () => Promise.resolve() };
const failing: ReadinessCheck = {
  name: 'redis',
  check: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:6379')),
};
const hanging: ReadinessCheck = { name: 'searxng', check: () => new Promise(() => undefined) };

describe('ops endpoints', () => {
  it('/healthz is 200 regardless of dependencies', async () => {
    const response = await server([failing]).app.inject({ url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('/readyz is 200 when every check passes', async () => {
    const response = await server([ok]).app.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: { redis: 'ok' } });
  });

  it('/readyz is 503 on a failing check, names it, and keeps error details in the log', async () => {
    const { app, lines } = server([failing]);
    const response = await app.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', checks: { redis: 'failed' } });
    expect(response.body).not.toContain('10.0.0.5');
    expect(lines.join('')).toContain('ECONNREFUSED');
  });

  it('/readyz fails a check that does not answer in time', async () => {
    const response = await server([ok, hanging]).app.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      checks: { redis: 'ok', searxng: 'failed' },
    });
  });

  it('/readyz is 503 while shutting down so traffic drains', async () => {
    const response = await server([ok], true).app.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'shutting_down' });
  });

  it('/metrics serves Prometheus text format with default process metrics', async () => {
    const response = await server([]).app.inject({ url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('process_cpu_user_seconds_total');
  });
});
