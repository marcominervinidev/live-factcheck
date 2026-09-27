import { LogController, fastify } from 'fastify';
import type { Registry } from 'prom-client';

import type { Logger } from './logger.js';

/** A dependency the service needs before it can take traffic. `check` rejects when not ready. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface CreateHttpServerOptions {
  readonly logger: Logger;
  readonly metrics: Registry;
  readonly readiness: () => readonly ReadinessCheck[];
  /**
   * While true, `/readyz` answers 503. In the current shutdown order the server stops accepting
   * connections right after, so this only affects requests already on open connections. Real
   * readiness-based draining (a delay between 503 and close) comes with Kubernetes in phase 5.
   */
  readonly isShuttingDown: () => boolean;
  readonly readinessTimeoutMs?: number;
}

async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms`));
    }, ms);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const OPS_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

/**
 * Fastify instance with the operational endpoints every service exposes (brief 4, 14.1):
 * `/healthz` (liveness), `/readyz` (readiness incl. dependencies) and `/metrics` (Prometheus).
 * Services register their own routes on the returned instance.
 */
export function createHttpServer(options: CreateHttpServerOptions) {
  const timeoutMs = options.readinessTimeoutMs ?? 1_000;
  const app = fastify({
    loggerInstance: options.logger,
    // Probes hit these endpoints every few seconds; request logs would drown everything else.
    logController: new LogController({
      disableRequestLogging: (request) => OPS_PATHS.has(request.url),
    }),
    bodyLimit: 64 * 1024,
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    if (options.isShuttingDown()) {
      return reply.code(503).send({ status: 'shutting_down', checks: {} });
    }
    const checks = options.readiness();
    const results = await Promise.all(
      checks.map(async (readinessCheck) => {
        const { name } = readinessCheck;
        try {
          await withTimeout(readinessCheck.check(), timeoutMs);
          return [name, 'ok'] as const;
        } catch (error) {
          // Details stay in the log; the endpoint reveals only which dependency failed.
          options.logger.warn({ err: error, check: name }, 'readiness check failed');
          return [name, 'failed'] as const;
        }
      }),
    );
    const ready = results.every(([, status]) => status === 'ok');
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', checks: Object.fromEntries(results) });
  });

  app.get('/metrics', async (_request, reply) => {
    return reply.type(options.metrics.contentType).send(await options.metrics.metrics());
  });

  return app;
}

export type HttpServer = ReturnType<typeof createHttpServer>;
