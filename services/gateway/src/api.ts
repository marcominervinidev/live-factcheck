import { randomUUID } from 'node:crypto';

import type { ApiErrorCode, ClaimDetected, ProviderStatus } from '@lfc/contracts';
import {
  ApiError,
  CheckClaimAccepted,
  CheckClaimRequest,
  ProviderStatus as ProviderStatusSchema,
  STREAMS,
} from '@lfc/contracts';
import rateLimit from '@fastify/rate-limit';
import type { HttpServer, Logger } from '@lfc/service-kit';
import { publishEvent } from '@lfc/service-kit';
import type { Redis } from 'ioredis';

import { bearerToken, tokenMatches } from './auth.js';
import type { Config } from './config.js';
import { normalizeClaimText } from './normalize.js';
import type { SessionStore } from './sessions.js';

const MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  unauthorized: 'Missing or invalid token',
  invalid_request: 'The request is not valid',
  rate_limited: 'Too many requests, try again in a minute',
  session_unknown: 'Unknown or expired session',
  budget_exceeded: 'The daily budget is used up',
  internal: 'Internal error',
};

export const apiError = (code: ApiErrorCode): ApiError =>
  ApiError.parse({ schemaVersion: 1, error: { code, message: MESSAGES[code] } });

const codeForStatus = (status: number): ApiErrorCode => {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'internal';
};

/**
 * Routes that answer without the gateway token: the ops endpoints (reachable only inside the
 * stack, Caddy forwards just /api and /ws) and the WebSocket, which authenticates with its first
 * message (ADR 0011).
 */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/healthz',
  '/readyz',
  '/metrics',
  '/ws/session',
]);

/** Workers publish what they use at startup (transcription, fact-checker, explainer); never keys or URLs. */
const WORKER_STATUS_KEYS = [
  'status:v1:transcription',
  'status:v1:fact-checker',
  'status:v1:explainer',
] as const;
const ProviderList = ProviderStatusSchema.shape.providers;

/** A corrupt status entry is skipped like a malformed one instead of failing the request. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export interface ApiDeps {
  readonly config: Config;
  readonly redis: Redis;
  readonly sessions: SessionStore;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** REST API v1 (ADR 0010, 0011): token check, text mode, provider status. */
export async function registerApi(app: HttpServer, deps: ApiDeps): Promise<void> {
  const { config, redis, sessions, logger } = deps;

  // Every error leaves as ApiError with a stable code; details only in the log.
  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send(apiError(codeForStatus(status)));
  });

  await app.register(rateLimit, {
    global: false,
    redis,
    nameSpace: 'ratelimit:v1:',
    // One user, one token (brief 3): the limit protects the budget, not per-client fairness.
    keyGenerator: () => 'text-mode',
  });

  // Deny by default, decided on the matched route and never on the raw URL: the router decodes
  // percent-encoded paths (/%61pi/status matches /api/status), a raw prefix check does not
  // (security review, phase 1). Unmatched paths need the token too, so they answer 401.
  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions.url;
    if (route !== undefined && PUBLIC_ROUTES.has(route)) return;
    if (!tokenMatches(config.GATEWAY_TOKEN, bearerToken(request.headers.authorization))) {
      await reply.code(401).send(apiError('unauthorized'));
    }
  });

  app.post(
    '/api/claims/check',
    {
      bodyLimit: 4 * 1024,
      config: { rateLimit: { max: config.RATE_LIMIT_CHECKS_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = CheckClaimRequest.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send(apiError('invalid_request'));
      const { sessionId, text } = parsed.data;
      if (!(await sessions.exists(sessionId)))
        return reply.code(404).send(apiError('session_unknown'));

      const claimId = randomUUID();
      const trimmed = text.trim();
      const payload: ClaimDetected = {
        schemaVersion: 3,
        sessionId,
        claimId,
        speaker: 'A',
        originalText: trimmed,
        standaloneText: trimmed,
        normalizedText: normalizeClaimText(trimmed) || trimmed,
        checkworthiness: 1,
        sourceSegmentIds: [],
        detectedAt: deps.now().toISOString(),
        // Typed claims need no detection (ADR 0017).
        detectMs: 0,
        provider: { classifier: 'text-mode', model: 'none' },
      };
      await publishEvent(
        redis,
        STREAMS.claimsDetected,
        { type: 'claim.detected', schemaVersion: 2, payload },
        { toSession: true },
      );
      // No claim text in the log (brief 15.6).
      logger.info({ sessionId, claimId }, 'text-mode claim accepted');
      return reply
        .code(202)
        .send(CheckClaimAccepted.parse({ schemaVersion: 1, sessionId, claimId }));
    },
  );

  app.get('/api/status', async () => {
    const providers: ProviderStatus['providers'] = [];
    for (const key of WORKER_STATUS_KEYS) {
      const raw = await redis.get(key);
      if (raw === null) continue;
      const entries = ProviderList.safeParse(parseJson(raw));
      if (entries.success) providers.push(...entries.data);
      else logger.warn({ key }, 'ignoring malformed provider status');
    }
    return ProviderStatusSchema.parse({
      schemaVersion: 2,
      privacyMode: config.PRIVACY_MODE,
      providers,
    });
  });
}
