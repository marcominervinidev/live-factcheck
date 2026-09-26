import { hostname } from 'node:os';

import { STREAMS } from '@lfc/contracts';
import {
  describeClassifierConfig,
  describeEmbeddingsConfig,
  describeLlmConfig,
} from '@lfc/providers';
import {
  createRedis,
  processedMarker,
  publishEvent,
  runService,
  startStreamConsumer,
} from '@lfc/service-kit';
import { Counter, Histogram } from 'prom-client';

import { configSchema, secretKeys } from './config.js';
import { checkClaim } from './pipeline.js';
import { createPipelineDeps, providerStatus } from './wiring.js';

const CHECK_TIMEOUT_MS = 60_000;

await runService({
  name: 'fact-checker',
  configSchema,
  secretKeys,
  start: ({ config, logger, metrics }) => {
    logger.info(
      {
        privacyMode: config.PRIVACY_MODE,
        research: config.CHECKER_RESEARCH_SOURCES,
        llm: describeLlmConfig('CHECKER', config),
        classifier: describeClassifierConfig('CHECKER', config),
        embeddings: describeEmbeddingsConfig(config),
        search: config.SEARCH_PROVIDER,
        factCheckApi: config.GOOGLE_FACTCHECK_API_KEY !== undefined,
      },
      'providers configured',
    );
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    const deps = createPipelineDeps(config, redis.client);
    const marker = processedMarker(redis.client, 'fact-checker', 7 * 24 * 3600);

    const checked = new Counter({
      name: 'claims_checked_total',
      help: 'Claims checked, by verdict and cache level',
      labelNames: ['verdict', 'cache_hit', 'reason'] as const,
      registers: [metrics],
    });
    const duration = new Histogram({
      name: 'claim_check_duration_seconds',
      help: 'Time from consuming claims.detected to publishing claims.checked',
      labelNames: ['cache_hit'] as const,
      buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 10, 15, 30, 60],
      registers: [metrics],
    });
    const costs = new Counter({
      name: 'claim_check_cost_usd_total',
      help: 'Estimated model cost of claim checks in USD (known prices only)',
      registers: [metrics],
    });

    // The gateway reads this for GET /api/status (plan T5.4); no keys, no URLs.
    void redis.client
      .set('status:v1:fact-checker', JSON.stringify(providerStatus(config)))
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'could not publish provider status');
      });

    const consumer = startStreamConsumer({
      redis: redis.client,
      stream: STREAMS.claimsDetected,
      group: 'fact-checker',
      consumer: `${hostname()}-${String(process.pid)}`,
      logger,
      handle: async ({ event }) => {
        if (event.type !== 'claim.detected') return;
        const { sessionId, claimId } = event.payload;
        if (await marker.isProcessed(claimId)) return;
        const result = await checkClaim(event.payload, deps, AbortSignal.timeout(CHECK_TIMEOUT_MS));
        await publishEvent(
          redis.client,
          STREAMS.claimsChecked,
          { type: 'claim.checked', schemaVersion: 2, payload: result },
          { toSession: true },
        );
        await marker.markProcessed(claimId);
        checked.inc({
          verdict: result.verdict,
          cache_hit: result.cacheHit,
          reason: result.reason ?? 'none',
        });
        duration.observe({ cache_hit: result.cacheHit }, result.timings.totalMs / 1_000);
        if (result.usage.estimatedCostUsd !== null) costs.inc(result.usage.estimatedCostUsd);
        // Claim text is transcript content: never logged (brief 15.6, LOG_TRANSCRIPTS=false).
        logger.info(
          {
            sessionId,
            claimId,
            verdict: result.verdict,
            confidenceLevel: result.confidenceLevel,
            cacheHit: result.cacheHit,
            reason: result.reason,
            totalMs: result.timings.totalMs,
          },
          'claim checked',
        );
      },
    });

    return Promise.resolve({
      readiness: [redis.readiness],
      stop: async () => {
        await consumer.stop();
        await redis.close();
      },
    });
  },
});
