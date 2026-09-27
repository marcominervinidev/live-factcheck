import { createRedis, runService } from '@lfc/service-kit';

import { registerApi } from './api.js';
import { configSchema, secretKeys } from './config.js';
import { sessionHub, sessionStore } from './sessions.js';
import { registerWebSocket } from './ws.js';

await runService({
  name: 'gateway',
  configSchema,
  secretKeys,
  start: async ({ config, logger, http }) => {
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    const sessions = sessionStore(redis.client, config.MAX_SESSION_MS);
    const hub = sessionHub(redis.client, logger);

    await registerApi(http, {
      config,
      redis: redis.client,
      sessions,
      logger,
      now: () => new Date(),
    });
    await registerWebSocket(http, { config, sessions, hub, logger });

    return {
      readiness: [redis.readiness],
      stop: async () => {
        hub.close();
        await redis.close();
      },
    };
  },
});
