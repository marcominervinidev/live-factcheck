import { z } from 'zod';

import { LanguageTag, Uuid } from './common.js';

/**
 * Live audio (brief 6.2–6.4; ADR 0015): PCM16 little-endian, mono, 16 kHz, sent as binary
 * WebSocket messages of nominally 100 ms. The limits are enforced by the gateway.
 */
export const AUDIO_SAMPLE_RATE = 16_000;
/** 100 ms of PCM16 mono at 16 kHz. */
export const AUDIO_FRAME_BYTES = 3_200;
export const AUDIO_FRAME_MAX_BYTES = 8 * 1024;
/** Average over a few seconds; leaves room for jitter and batching in the browser. */
export const AUDIO_FRAMES_PER_SECOND_MAX = 20;

/** The only format the pipeline accepts; a different one is rejected, never converted. */
export const AudioFormat = {
  sampleRate: z.literal(AUDIO_SAMPLE_RATE),
  encoding: z.literal('pcm16'),
  channels: z.literal(1),
  language: LanguageTag,
};

/** Why a recording ended. Shown to the user, so every value has a German text in the web app. */
export const AudioStopReason = z.enum([
  'client',
  'recording_limit',
  'overloaded',
  'budget_exceeded',
  'provider_error',
]);
export type AudioStopReason = z.infer<typeof AudioStopReason>;

/**
 * Internal protocol gateway → `transcription` (`ws://transcription:8080/v1/audio`, network
 * `internal` only): one connection per recording; JSON control messages, binary frames unchanged
 * from the client in between.
 */
export const TranscriptionStart = z.strictObject({
  type: z.literal('start'),
  schemaVersion: z.literal(1),
  sessionId: Uuid,
  recordingId: Uuid,
  ...AudioFormat,
});
export type TranscriptionStart = z.infer<typeof TranscriptionStart>;

export const TranscriptionStop = z.strictObject({
  type: z.literal('stop'),
  schemaVersion: z.literal(1),
});

export const TranscriptionClientMessage = z.discriminatedUnion('type', [
  TranscriptionStart,
  TranscriptionStop,
]);
export type TranscriptionClientMessage = z.infer<typeof TranscriptionClientMessage>;

export const TranscriptionReady = z.strictObject({
  type: z.literal('ready'),
  schemaVersion: z.literal(1),
  recordingId: Uuid,
});

export const TranscriptionStopped = z.strictObject({
  type: z.literal('stopped'),
  schemaVersion: z.literal(1),
  recordingId: Uuid,
  reason: AudioStopReason,
});

export const TranscriptionServerMessage = z.discriminatedUnion('type', [
  TranscriptionReady,
  TranscriptionStopped,
]);
export type TranscriptionServerMessage = z.infer<typeof TranscriptionServerMessage>;
