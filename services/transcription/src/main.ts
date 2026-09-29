import { createDailyBudget, createSttProvider, describeSttConfig, sttUse } from '@lfc/providers';
import { createRedis, runService } from '@lfc/service-kit';

import { configSchema, secretKeys } from './config.js';
import { registerAudioRoute } from './server.js';

await runService({
  name: 'transcription',
  configSchema,
  secretKeys,
  start: async ({ config, logger, http }) => {
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    const stt = createSttProvider(config);
    const use = sttUse(config);
    const described = describeSttConfig(config);
    logger.info(
      { privacyMode: config.PRIVACY_MODE, stt: described, cloud: use.cloud },
      'providers',
    );

    // The settings page and the consent dialog name the active STT provider (brief 11, 15.6).
    const publishStatus = () => {
      const status = [
        {
          service: 'transcription',
          role: 'stt',
          provider: described.provider,
          model: described.model.slice(0, 128),
          cloud: use.cloud,
        },
      ];
      redis.client
        .set('status:v1:transcription', JSON.stringify(status))
        .catch((error: unknown) => {
          logger.warn({ err: error }, 'could not publish provider status');
        });
    };
    redis.client.on('ready', publishStatus);
    if (redis.client.status === 'ready') publishStatus();

    await registerAudioRoute(http, {
      redis: redis.client,
      stt,
      // Only cloud STT costs money and counts against the daily budget (brief 15.5).
      budget: use.cloud
        ? createDailyBudget(redis.client, config.CLOUD_DAILY_BUDGET_USD)
        : undefined,
      maxBufferedBytes: config.STT_MAX_BUFFERED_BYTES,
      logger,
    });

    return {
      readiness: [redis.readiness],
      stop: () => redis.close(),
    };
  },
});
