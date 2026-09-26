import { Registry, collectDefaultMetrics } from 'prom-client';
import type { z } from 'zod';

import { ConfigError, loadConfig } from './config.js';
import type { BaseConfig } from './config.js';
import { createHttpServer } from './http.js';
import type { HttpServer, ReadinessCheck } from './http.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';

export interface ServiceContext<Config> {
  readonly config: Config;
  readonly logger: Logger;
  readonly metrics: Registry;
  /** Register service routes here; the server starts listening after `start` resolves. */
  readonly http: HttpServer;
}

export interface StartedService {
  readonly readiness: readonly ReadinessCheck[];
  /** Finish or hand back in-flight work and release connections (brief 4.1 factor IX). */
  stop(): Promise<void>;
}

/** A service config schema: any zod object whose output includes the base fields (PORT, …). */
export type ServiceConfigSchema = z.ZodObject & z.ZodType<BaseConfig>;

export interface ServiceDefinition<Schema extends ServiceConfigSchema> {
  readonly name: string;
  /** Built from `baseConfigSchema.extend(…)`; the type rejects schemas without the base fields. */
  readonly configSchema: Schema;
  readonly secretKeys: readonly Extract<keyof z.infer<Schema>, string>[];
  start(context: ServiceContext<z.infer<Schema>>): Promise<StartedService>;
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Runs a service: validate config (exit 1 on error), start, serve ops endpoints on PORT,
 * and shut down cleanly on SIGTERM/SIGINT within SHUTDOWN_TIMEOUT_MS.
 */
export async function runService<Schema extends ServiceConfigSchema>(
  definition: ServiceDefinition<Schema>,
): Promise<void> {
  let loaded: ReturnType<typeof loadConfig<Schema>>;
  try {
    loaded = loadConfig(definition.configSchema, { secretKeys: definition.secretKeys });
  } catch (error) {
    // No config means no log level yet; report at fatal on stdout and stop.
    const logger = createLogger({ service: definition.name, level: 'info' });
    if (error instanceof ConfigError) {
      logger.fatal({ issues: error.issues }, 'invalid configuration, exiting');
    } else {
      logger.fatal({ err: error }, 'failed to load configuration, exiting');
    }
    process.exit(1);
  }

  const config: z.infer<Schema> = loaded.config;
  const logger = createLogger({
    service: definition.name,
    level: config.LOG_LEVEL,
    secretKeys: definition.secretKeys,
    secretValues: loaded.secretValues,
  });

  const metrics = new Registry();
  metrics.setDefaultLabels({ service: definition.name });
  collectDefaultMetrics({ register: metrics });

  let shuttingDown = false;
  let readiness: readonly ReadinessCheck[] = [];
  const http = createHttpServer({
    logger,
    metrics,
    readiness: () => readiness,
    isShuttingDown: () => shuttingDown,
  });

  let service: StartedService;
  try {
    service = await definition.start({ config, logger, metrics, http });
    readiness = service.readiness;
    await http.listen({ host: '0.0.0.0', port: config.PORT });
  } catch (error) {
    logger.fatal({ err: error }, 'failed to start, exiting');
    process.exit(1);
  }
  logger.info({ port: config.PORT }, 'service started');

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error({ timeoutMs: config.SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out, exiting');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      await http.close();
      await service.stop();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  for (const signal of SIGNALS) {
    process.once(signal, () => void shutdown(signal));
  }
}
