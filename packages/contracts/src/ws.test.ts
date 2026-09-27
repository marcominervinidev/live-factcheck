import { describe, expect, it } from 'vitest';

import { SESSION_ID, validChecked, validExplained } from './testing/fixtures.js';
import { WsClientMessage, WsServerMessage } from './ws.js';

describe('WebSocket client messages v1', () => {
  it('accepts the auth message', () => {
    const auth = { type: 'auth', schemaVersion: 1, token: 'a-long-random-gateway-token' };
    expect(WsClientMessage.parse(auth)).toEqual(auth);
  });

  it.each([
    ['an empty token', { type: 'auth', schemaVersion: 1, token: '' }],
    ['an oversized token', { type: 'auth', schemaVersion: 1, token: 'x'.repeat(513) }],
    ['a phase 2 message', { type: 'start', schemaVersion: 1 }],
    ['an unknown field', { type: 'auth', schemaVersion: 1, token: 't', sessionId: SESSION_ID }],
  ])('rejects %s', (_label, message) => {
    expect(WsClientMessage.safeParse(message).success).toBe(false);
  });
});

describe('WebSocket server messages v1', () => {
  it.each([
    ['session.ready', { type: 'session.ready', schemaVersion: 1, sessionId: SESSION_ID }],
    [
      'error',
      { type: 'error', schemaVersion: 1, code: 'auth_timeout', message: 'No auth within 5 s' },
    ],
    [
      'event (verdict)',
      {
        type: 'event',
        schemaVersion: 1,
        event: { type: 'claim.checked', schemaVersion: 2, payload: validChecked() },
      },
    ],
    [
      'event (explanation)',
      {
        type: 'event',
        schemaVersion: 1,
        event: { type: 'claim.explained', schemaVersion: 2, payload: validExplained() },
      },
    ],
  ])('round-trips %s through JSON', (_label, message) => {
    expect(WsServerMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });

  it('rejects an event whose envelope is invalid', () => {
    const message = {
      type: 'event',
      schemaVersion: 1,
      event: { type: 'claim.checked', schemaVersion: 2, payload: validExplained() },
    };
    expect(WsServerMessage.safeParse(message).success).toBe(false);
  });

  it('rejects unknown error codes', () => {
    expect(
      WsServerMessage.safeParse({ type: 'error', schemaVersion: 1, code: 'oops', message: 'x' })
        .success,
    ).toBe(false);
  });
});
