import { describe, expect, it } from 'vitest';

import {
  AUDIO_FRAME_BYTES,
  AUDIO_FRAME_MAX_BYTES,
  AUDIO_SAMPLE_RATE,
  TranscriptionClientMessage,
  TranscriptionServerMessage,
} from './audio.js';
import { SESSION_ID } from './testing/fixtures.js';

const RECORDING_ID = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';

const start = {
  type: 'start',
  schemaVersion: 1,
  sessionId: SESSION_ID,
  recordingId: RECORDING_ID,
  sampleRate: 16_000,
  encoding: 'pcm16',
  channels: 1,
  language: 'de',
};

describe('audio frame budget', () => {
  it('is 100 ms of PCM16 mono at 16 kHz, with room for batching', () => {
    expect(AUDIO_FRAME_BYTES).toBe((AUDIO_SAMPLE_RATE / 10) * 2);
    expect(AUDIO_FRAME_MAX_BYTES).toBeGreaterThan(2 * AUDIO_FRAME_BYTES);
  });
});

describe('internal audio protocol gateway → transcription v1', () => {
  it.each([
    ['start', start],
    ['stop', { type: 'stop', schemaVersion: 1 }],
  ])('accepts the client message %s', (_label, message) => {
    expect(TranscriptionClientMessage.parse(message)).toEqual(message);
  });

  it.each([
    ['ready', { type: 'ready', schemaVersion: 1, recordingId: RECORDING_ID }],
    [
      'stopped',
      { type: 'stopped', schemaVersion: 1, recordingId: RECORDING_ID, reason: 'budget_exceeded' },
    ],
  ])('accepts the server message %s', (_label, message) => {
    expect(TranscriptionServerMessage.parse(message)).toEqual(message);
  });

  it.each([
    ['a start without session', { ...start, sessionId: undefined }],
    ['a start with an invalid recording id', { ...start, recordingId: 'rec-1' }],
    ['a start with another sample rate', { ...start, sampleRate: 8_000 }],
    ['a start with an unknown field', { ...start, token: 'secret' }],
    ['a stop of another version', { type: 'stop', schemaVersion: 2 }],
  ])('rejects %s', (_label, message) => {
    expect(TranscriptionClientMessage.safeParse(message).success).toBe(false);
  });

  it('rejects an unknown stop reason', () => {
    expect(
      TranscriptionServerMessage.safeParse({
        type: 'stopped',
        schemaVersion: 1,
        recordingId: RECORDING_ID,
        reason: 'privacy_mode',
      }).success,
    ).toBe(false);
  });
});
