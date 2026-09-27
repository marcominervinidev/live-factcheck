import { z } from 'zod';

import { Uuid, text } from './common.js';
import { EventEnvelope } from './envelope.js';

/**
 * WebSocket `/ws/session`, JSON text frames (brief 6.1, 6.7; ADR 0010). Audio control messages
 * (`start`, `stop`, `rename`) follow in phase 2 with a version bump.
 */

/** First client message: browsers cannot set headers on the handshake, and tokens never go into URLs (brief 15.5). */
export const WsAuth = z.strictObject({
  type: z.literal('auth'),
  schemaVersion: z.literal(1),
  token: z.string().min(1).max(512),
});
export type WsAuth = z.infer<typeof WsAuth>;

export const WsClientMessage = z.discriminatedUnion('type', [WsAuth]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

export const WsErrorCode = z.enum([
  'unauthorized',
  'auth_timeout',
  'invalid_message',
  'session_expired',
  'internal',
]);
export type WsErrorCode = z.infer<typeof WsErrorCode>;

export const WsSessionReady = z.strictObject({
  type: z.literal('session.ready'),
  schemaVersion: z.literal(1),
  sessionId: Uuid,
});

export const WsError = z.strictObject({
  type: z.literal('error'),
  schemaVersion: z.literal(1),
  code: WsErrorCode,
  message: text(300),
});

/** A pipeline event of this session, forwarded from `session:{sessionId}:events`. */
export const WsEvent = z.strictObject({
  type: z.literal('event'),
  schemaVersion: z.literal(1),
  event: EventEnvelope,
});

export const WsServerMessage = z.discriminatedUnion('type', [WsSessionReady, WsError, WsEvent]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
