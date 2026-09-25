import { createRedis, runService } from '@lfc/service-kit';

import { configSchema, secretKeys } from './config.js';

await runService({
  name: 'gateway',
  configSchema,
  secretKeys,
  start: ({ config, logger }) => {
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    return Promise.resolve({
      readiness: [redis.readiness],
      stop: () => redis.close(),
    });
  },
});
