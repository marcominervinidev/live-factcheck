import { z } from 'zod';

import { AudioFormat, AudioStopReason } from './audio.js';
import { Uuid, text } from './common.js';
import { EventEnvelope } from './envelope.js';

/**
 * WebSocket `/ws/session`, protocol v2 (brief 6.1–6.2, 6.7; ADR 0010, 0011, 0015): JSON text
 * frames for control, binary frames for audio (PCM16, see `audio.ts`) between `audio.start` and
 * `audio.stop`. v1 messages are rejected.
 */

/** First client message: browsers cannot set headers on the handshake, and tokens never go into URLs (brief 15.5). */
export const WsAuth = z.strictObject({
  type: z.literal('auth'),
  schemaVersion: z.literal(2),
  token: z.string().min(1).max(512),
});
export type WsAuth = z.infer<typeof WsAuth>;

/** Starts a recording; binary frames are accepted only afterwards. One recording at a time. */
export const WsAudioStart = z.strictObject({
  type: z.literal('audio.start'),
  schemaVersion: z.literal(2),
  ...AudioFormat,
});
export type WsAudioStart = z.infer<typeof WsAudioStart>;

export const WsAudioStop = z.strictObject({
  type: z.literal('audio.stop'),
  schemaVersion: z.literal(2),
});

export const WsClientMessage = z.discriminatedUnion('type', [WsAuth, WsAudioStart, WsAudioStop]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

export const WsErrorCode = z.enum([
  'unauthorized',
  'auth_timeout',
  'invalid_message',
  'session_expired',
  'internal',
  'audio_not_started',
  'audio_already_started',
  'frame_too_large',
  'frame_rate_exceeded',
]);
export type WsErrorCode = z.infer<typeof WsErrorCode>;

export const WsSessionReady = z.strictObject({
  type: z.literal('session.ready'),
  schemaVersion: z.literal(2),
  sessionId: Uuid,
});

export const WsError = z.strictObject({
  type: z.literal('error'),
  schemaVersion: z.literal(2),
  code: WsErrorCode,
  message: text(300),
});

/** A pipeline event of this session, forwarded from `session:{sessionId}:events`. */
export const WsEvent = z.strictObject({
  type: z.literal('event'),
  schemaVersion: z.literal(2),
  event: EventEnvelope,
});

/** The recording runs; transcript segments follow as `event` messages. */
export const WsAudioStarted = z.strictObject({
  type: z.literal('audio.started'),
  schemaVersion: z.literal(2),
  recordingId: Uuid,
});

export const WsAudioStopped = z.strictObject({
  type: z.literal('audio.stopped'),
  schemaVersion: z.literal(2),
  recordingId: Uuid,
  reason: AudioStopReason,
});

export const WsServerMessage = z.discriminatedUnion('type', [
  WsSessionReady,
  WsError,
  WsEvent,
  WsAudioStarted,
  WsAudioStopped,
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
