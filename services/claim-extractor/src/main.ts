import { describeLlmConfig } from '@lfc/providers';
import { createRedis, runService } from '@lfc/service-kit';

import { configSchema, secretKeys } from './config.js';

await runService({
  name: 'claim-extractor',
  configSchema,
  secretKeys,
  start: ({ config, logger }) => {
    logger.info({ llm: describeLlmConfig('EXTRACTOR', config) }, 'llm provider configured');
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
