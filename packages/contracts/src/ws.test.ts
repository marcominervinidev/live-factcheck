import { describe, expect, it } from 'vitest';

import { SESSION_ID, validChecked, validExplained, validSegment } from './testing/fixtures.js';
import { WsClientMessage, WsServerMessage } from './ws.js';

const RECORDING_ID = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';

const audioStart = {
  type: 'audio.start',
  schemaVersion: 2,
  sampleRate: 16_000,
  encoding: 'pcm16',
  channels: 1,
  language: 'de',
};

describe('WebSocket client messages v2', () => {
  it.each([
    ['auth', { type: 'auth', schemaVersion: 2, token: 'a-long-random-gateway-token' }],
    ['audio.start', audioStart],
    ['audio.stop', { type: 'audio.stop', schemaVersion: 2 }],
  ])('accepts %s', (_label, message) => {
    expect(WsClientMessage.parse(message)).toEqual(message);
  });

  it.each([
    ['a v1 auth message', { type: 'auth', schemaVersion: 1, token: 'token' }],
    ['an empty token', { type: 'auth', schemaVersion: 2, token: '' }],
    ['an oversized token', { type: 'auth', schemaVersion: 2, token: 'x'.repeat(513) }],
    ['an unknown field', { type: 'auth', schemaVersion: 2, token: 't', sessionId: SESSION_ID }],
    ['another sample rate', { ...audioStart, sampleRate: 48_000 }],
    ['another encoding', { ...audioStart, encoding: 'opus' }],
    ['stereo', { ...audioStart, channels: 2 }],
    ['a missing language', { ...audioStart, language: undefined }],
    ['an invalid language', { ...audioStart, language: 'deutsch!' }],
    ['a stop with extra fields', { type: 'audio.stop', schemaVersion: 2, reason: 'x' }],
    ['an unknown type', { type: 'rename', schemaVersion: 2 }],
  ])('rejects %s', (_label, message) => {
    expect(WsClientMessage.safeParse(message).success).toBe(false);
  });
});

describe('WebSocket server messages v2', () => {
  it.each([
    ['session.ready', { type: 'session.ready', schemaVersion: 2, sessionId: SESSION_ID }],
    [
      'error',
      { type: 'error', schemaVersion: 2, code: 'frame_too_large', message: 'At most 8 KiB' },
    ],
    [
      'event (interim transcript segment)',
      {
        type: 'event',
        schemaVersion: 2,
        event: {
          type: 'transcript.segment',
          schemaVersion: 2,
          payload: { ...validSegment(), isFinal: false },
        },
      },
    ],
    [
      'event (verdict)',
      {
        type: 'event',
        schemaVersion: 2,
        event: { type: 'claim.checked', schemaVersion: 2, payload: validChecked() },
      },
    ],
    [
      'event (explanation)',
      {
        type: 'event',
        schemaVersion: 2,
        event: { type: 'claim.explained', schemaVersion: 2, payload: validExplained() },
      },
    ],
    ['audio.started', { type: 'audio.started', schemaVersion: 2, recordingId: RECORDING_ID }],
    [
      'audio.stopped',
      { type: 'audio.stopped', schemaVersion: 2, recordingId: RECORDING_ID, reason: 'overloaded' },
    ],
  ])('round-trips %s through JSON', (_label, message) => {
    expect(WsServerMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });

  it('rejects an event whose envelope is invalid', () => {
    const message = {
      type: 'event',
      schemaVersion: 2,
      event: { type: 'claim.checked', schemaVersion: 2, payload: validExplained() },
    };
    expect(WsServerMessage.safeParse(message).success).toBe(false);
  });

  it.each([
    ['an unknown error code', { type: 'error', schemaVersion: 2, code: 'oops', message: 'x' }],
    ['a v1 session.ready', { type: 'session.ready', schemaVersion: 1, sessionId: SESSION_ID }],
    [
      'an unknown stop reason',
      { type: 'audio.stopped', schemaVersion: 2, recordingId: RECORDING_ID, reason: 'bored' },
    ],
    ['audio.started without recording id', { type: 'audio.started', schemaVersion: 2 }],
  ])('rejects %s', (_label, message) => {
    expect(WsServerMessage.safeParse(message).success).toBe(false);
  });
});
