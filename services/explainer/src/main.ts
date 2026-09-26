import { hostname } from 'node:os';

import { STREAMS } from '@lfc/contracts';
import {
  createDailyBudget,
  createLlmProvider,
  describeLlmConfig,
  llmUse,
  loadPromptTemplate,
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
import { explain, mockExplanation } from './explain.js';

const EXPLAIN_TIMEOUT_MS = 45_000;

await runService({
  name: 'explainer',
  configSchema,
  secretKeys,
  start: ({ config, logger, metrics }) => {
    logger.info(
      { privacyMode: config.PRIVACY_MODE, llm: describeLlmConfig('EXPLAINER', config) },
      'providers configured',
    );
    const redis = createRedis({
      url: config.REDIS_URL,
      ...(config.REDIS_USERNAME === undefined ? {} : { username: config.REDIS_USERNAME }),
      password: config.REDIS_PASSWORD,
      logger,
    });
    const deps = {
      llm: createLlmProvider('EXPLAINER', config, { mock: mockExplanation }),
      prompt: loadPromptTemplate(new URL('../prompts/explanation.md', import.meta.url)),
      ...(llmUse('EXPLAINER', config).cloud
        ? { budget: createDailyBudget(redis.client, config.CLOUD_DAILY_BUDGET_USD) }
        : {}),
    };
    const marker = processedMarker(redis.client, 'explainer', 7 * 24 * 3600);
    const explained = new Counter({
      name: 'explanations_total',
      help: 'Explanations published',
      registers: [metrics],
    });
    const failed = new Counter({
      name: 'explanations_failed_total',
      help: 'Verdicts without explanation, by reason (the card keeps its placeholder)',
      labelNames: ['reason'] as const,
      registers: [metrics],
    });

    void redis.client
      .set(
        'status:v1:explainer',
        JSON.stringify([
          {
            service: 'explainer',
            role: 'llm',
            provider: config.EXPLAINER_LLM_PROVIDER,
            model: config.EXPLAINER_LLM_MODEL,
            cloud: llmUse('EXPLAINER', config).cloud,
          },
        ]),
      )
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'could not publish provider status');
      });

    const consumer = startStreamConsumer({
      redis: redis.client,
      stream: STREAMS.claimsChecked,
      group: 'explainer',
      consumer: `${hostname()}-${String(process.pid)}`,
      logger,
      handle: async ({ event }) => {
        if (event.type !== 'claim.checked') return;
        const { sessionId, claimId } = event.payload;
        if (await marker.isProcessed(claimId)) return;
        const outcome = await explain(event.payload, deps, AbortSignal.timeout(EXPLAIN_TIMEOUT_MS));
        if (outcome.ok) {
          await publishEvent(
            redis.client,
            STREAMS.claimsExplained,
            { type: 'claim.explained', schemaVersion: 2, payload: outcome.event },
            { toSession: true },
          );
          explained.inc();
        } else {
          failed.inc({ reason: outcome.reason });
          logger.warn({ sessionId, claimId, reason: outcome.reason }, 'no explanation');
        }
        // Marked either way: a failed explanation is not retried (the verdict is already shown).
        await marker.markProcessed(claimId);
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
