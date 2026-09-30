import { hostname } from 'node:os';

import { STREAMS } from '@lfc/contracts';
import {
  classifierUse,
  createClassifier,
  createDailyBudget,
  createLlmProvider,
  describeClassifierConfig,
  describeLlmConfig,
  llmUse,
  loadPromptTemplate,
  resolveClassifierConfig,
} from '@lfc/providers';
import {
  createRedis,
  processedMarker,
  publishEvent,
  runService,
  startStreamConsumer,
} from '@lfc/service-kit';
import { Counter } from 'prom-client';

import { configSchema, secretKeys } from './config.js';
import { detectClaim } from './detect.js';
import { mockDetector, mockStandalone } from './mocks.js';
import { redisSessionStore } from './store.js';

await runService({
  name: 'claim-extractor',
  configSchema,
  secretKeys,
  start: ({ config, logger, metrics }) => {
    const llmCloud = llmUse('EXTRACTOR', config).cloud;
    const classifierCloud = classifierUse('DETECTOR', config).cloud;
    logger.info(
      {
        privacyMode: config.PRIVACY_MODE,
        llm: describeLlmConfig('EXTRACTOR', config),
        classifier: describeClassifierConfig('DETECTOR', config),
      },
      'providers configured',
    );
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    const llm = createLlmProvider('EXTRACTOR', config, { mock: mockStandalone });
    const classifier = createClassifier('DETECTOR', config, { llm, mock: mockDetector });
    const resolved = resolveClassifierConfig('DETECTOR', config);
    const deps = {
      classifier,
      llm,
      prompt: loadPromptTemplate(new URL('../prompts/standalone.md', import.meta.url)),
      store: redisSessionStore(redis.client, {
        windowSize: config.DETECTOR_WINDOW_SEGMENTS,
        candidates: config.DETECTOR_DEDUP_CANDIDATES,
        ttlMs: config.EXTRACTOR_MEMORY_TTL_MS,
      }),
      ...(llmCloud || classifierCloud
        ? { budget: createDailyBudget(redis.client, config.CLOUD_DAILY_BUDGET_USD) }
        : {}),
      thresholds: { high: resolved.high, low: resolved.low },
      minScore: config.DETECTOR_MIN_SCORE,
      minWords: config.DETECTOR_MIN_WORDS,
      now: () => new Date(),
      clock: () => performance.now(),
    };
    const marker = processedMarker(redis.client, 'claim-extractor', 7 * 24 * 3600);
    const detected = new Counter({
      name: 'claims_detected_total',
      help: 'Claims published to claims.detected',
      registers: [metrics],
    });
    const dropped = new Counter({
      name: 'segments_dropped_total',
      help: 'Final segments without a claim, by reason (pre-filter, classifier, duplicate, failure)',
      labelNames: ['reason'] as const,
      registers: [metrics],
    });

    // The gateway reads this for GET /api/status; no keys, no URLs.
    const publishStatus = () => {
      redis.client
        .set(
          'status:v1:claim-extractor',
          JSON.stringify([
            {
              service: 'claim-extractor',
              role: 'classifier',
              provider: resolved.provider,
              ...(resolved.model === undefined ? {} : { model: resolved.model }),
              cloud: classifierCloud,
            },
            {
              service: 'claim-extractor',
              role: 'llm',
              provider: config.EXTRACTOR_LLM_PROVIDER,
              model: config.EXTRACTOR_LLM_MODEL,
              cloud: llmCloud,
            },
          ]),
        )
        .catch((error: unknown) => {
          logger.warn({ err: error }, 'could not publish provider status');
        });
    };
    redis.client.on('ready', publishStatus);
    if (redis.client.status === 'ready') publishStatus();

    const consumer = startStreamConsumer({
      redis: redis.client,
      stream: STREAMS.transcriptSegments,
      group: 'claim-extractor',
      consumer: `${hostname()}-${String(process.pid)}`,
      batchSize: 1,
      claimIdleMs: config.EXTRACTOR_TIMEOUT_MS + 30_000,
      logger,
      handle: async ({ event }) => {
        if (event.type !== 'transcript.segment' || !event.payload.isFinal) return;
        const { sessionId, segmentId } = event.payload;
        if (await marker.isProcessed(segmentId)) return;
        const outcome = await detectClaim(event.payload, deps);
        if (outcome.kind === 'claim') {
          await publishEvent(
            redis.client,
            STREAMS.claimsDetected,
            { type: 'claim.detected', schemaVersion: 2, payload: outcome.claim },
            { toSession: true },
          );
          detected.inc();
          logger.info(
            {
              sessionId,
              segmentId,
              claimId: outcome.claim.claimId,
              detectMs: outcome.claim.detectMs,
            },
            'claim detected',
          );
        } else {
          dropped.inc({ reason: outcome.reason });
        }
        await marker.markProcessed(segmentId);
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
