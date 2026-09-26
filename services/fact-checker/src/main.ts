import { describeClassifierConfig, describeLlmConfig } from '@lfc/providers';
import { createRedis, runService } from '@lfc/service-kit';

import { configSchema, secretKeys } from './config.js';

await runService({
  name: 'fact-checker',
  configSchema,
  secretKeys,
  start: ({ config, logger }) => {
    logger.info(
      {
        privacyMode: config.PRIVACY_MODE,
        llm: describeLlmConfig('CHECKER', config),
        classifier: describeClassifierConfig('CHECKER', config),
      },
      'providers configured',
    );
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
