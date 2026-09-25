# @lfc/service-kit

Shared runtime for all Node services of live-factcheck.

| Module | Purpose |
|---|---|
| `loadConfig`, `baseConfigSchema` | zod-validated env config, fail fast, secrets via `<KEY>_FILE` |
| `createLogger` | pino JSON on stdout; secret fields redacted and secret values scrubbed from every line |
| `createHttpServer` | Fastify with `/healthz`, `/readyz`, `/metrics` |
| `createRedis` | ioredis client that fails fast, plus a readiness check |
| `runService` | wires everything, listens on `PORT`, graceful shutdown on SIGTERM/SIGINT |
| `@lfc/service-kit/healthcheck` | container healthcheck without curl |

```ts
import { baseConfigSchema, createRedis, runService } from '@lfc/service-kit';
import { z } from 'zod';

await runService({
  name: 'gateway',
  configSchema: baseConfigSchema.extend({ REDIS_URL: z.url(), REDIS_PASSWORD: z.string().min(1) }),
  secretKeys: ['REDIS_PASSWORD'],
  async start({ config, logger }) {
    const redis = createRedis({ url: config.REDIS_URL, password: config.REDIS_PASSWORD, logger });
    return { readiness: [redis.readiness], stop: () => redis.close() };
  },
});
```
