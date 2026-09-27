import { z } from 'zod';

import { Uuid, text } from './common.js';

/** `POST /api/claims/check`: text mode (brief 6.8, ADR 0010). The session comes from `/ws/session`. */
export const CheckClaimRequest = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Uuid,
  text: text(1_000),
});
export type CheckClaimRequest = z.infer<typeof CheckClaimRequest>;

/** `202` answer to `CheckClaimRequest`; the result arrives on the WebSocket. */
export const CheckClaimAccepted = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Uuid,
  claimId: Uuid,
});
export type CheckClaimAccepted = z.infer<typeof CheckClaimAccepted>;

export const ProviderRole = z.enum(['llm', 'classifier', 'embeddings', 'search', 'factcheck']);
export type ProviderRole = z.infer<typeof ProviderRole>;

/**
 * `GET /api/status`: which providers are active and whether data leaves the own network
 * (brief 11, 15.6). Never contains keys or URLs with credentials.
 */
export const ProviderStatus = z.strictObject({
  schemaVersion: z.literal(1),
  privacyMode: z.enum(['cloud', 'local']),
  providers: z
    .array(
      z.strictObject({
        service: text(64),
        role: ProviderRole,
        provider: text(64),
        model: text(128).optional(),
        cloud: z.boolean(),
      }),
    )
    .max(30),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

/** Stable machine-readable error codes of the HTTP API. */
export const ApiErrorCode = z.enum([
  'unauthorized',
  'invalid_request',
  'rate_limited',
  'session_unknown',
  'budget_exceeded',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Body of every 4xx/5xx answer. `message` is English and safe to show; never internals. */
export const ApiError = z.strictObject({
  schemaVersion: z.literal(1),
  error: z.strictObject({ code: ApiErrorCode, message: text(300) }),
});
export type ApiError = z.infer<typeof ApiError>;
