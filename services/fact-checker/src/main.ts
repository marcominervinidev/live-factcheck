import { hostname } from 'node:os';

import type { ClaimDetected } from '@lfc/contracts';
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
import type { ResearchSummary } from './pipeline.js';
import { checkClaim } from './pipeline.js';

await runService({
  name: 'fact-checker',
  configSchema,
  secretKeys,
  start: async ({ config, logger, metrics }) => {
    // Loaded only after the config is valid: the research stack (jsdom, undici, SDKs) is heavy,
    // and a misconfigured service must fail fast (brief 4.1 factor III).
    const { createPipelineDeps, providerStatus } = await import('./wiring.js');
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
    if (config.CHECKER_MOCK_INJECTED_PAGE === 'on') {
      logger.warn('red-team corpus on: moon-landing claims get a crafted injection page');
    }
    if (config.CHECKER_RESEARCH_SOURCES === 'mock' && config.CHECKER_LLM_PROVIDER !== 'mock') {
      // The mock corpus is for tests and contains a crafted red-team page (security review,
      // phase 1b): with a real model this is a test setup, never a real fact check.
      logger.warn(
        { research: 'mock', llm: config.CHECKER_LLM_PROVIDER },
        'real model with the mock research corpus (test data incl. a red-team page); set CHECKER_RESEARCH_SOURCES=live for real checks',
      );
    }
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    const deps = {
      ...createPipelineDeps(config, redis.client),
      // Diagnose log (plan D1): where a check found or lost its evidence, counts only.
      onResearch: (detected: ClaimDetected, summary: ResearchSummary) => {
        logger.info(
          { sessionId: detected.sessionId, claimId: detected.claimId, ...summary },
          'research summary',
        );
      },
    };
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

    // The gateway reads this for GET /api/status; no keys, no URLs. Written on every (re)connect,
    // because the service-kit client has no offline queue.
    const publishStatus = () => {
      redis.client
        .set('status:v1:fact-checker', JSON.stringify(providerStatus(config)))
        .catch((error: unknown) => {
          logger.warn({ err: error }, 'could not publish provider status');
        });
    };
    redis.client.on('ready', publishStatus);
    if (redis.client.status === 'ready') publishStatus();

    const consumer = startStreamConsumer({
      redis: redis.client,
      stream: STREAMS.claimsDetected,
      group: 'fact-checker',
      consumer: `${hostname()}-${String(process.pid)}`,
      // One entry at a time: a handler runs up to CHECKER_TIMEOUT_MS, so entries waiting in a larger
      // batch would exceed claimIdleMs and be taken over by another replica (review, phase 1).
      batchSize: 1,
      claimIdleMs: config.CHECKER_TIMEOUT_MS + 30_000,
      logger,
      handle: async ({ event }) => {
        if (event.type !== 'claim.detected') return;
        const { sessionId, claimId } = event.payload;
        if (await marker.isProcessed(claimId)) return;
        const result = await checkClaim(
          event.payload,
          deps,
          AbortSignal.timeout(config.CHECKER_TIMEOUT_MS),
        );
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

    return {
      readiness: [redis.readiness],
      stop: async () => {
        await consumer.stop();
        await redis.close();
      },
    };
  },
});
