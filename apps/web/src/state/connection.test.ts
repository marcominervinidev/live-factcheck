import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLAIM_ID, SESSION_ID, checked, explained } from '../testing/fixtures';
import { useClaims } from './claims';
import type { SocketLike } from './connection';
import { EXPLANATION_TIMEOUT_MS, backoffDelay, sessionUrl, useConnection } from './connection';

/** A fake WebSocket at the network boundary. */
class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  // Test helpers
  open() {
    this.onopen?.call(this, {});
  }
  receive(message: unknown) {
    this.onmessage?.call(this, { data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.onclose?.call(this, { code });
  }
}

const factory = (url: string) => new FakeSocket(url);
const last = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error('no socket created');
  return socket;
};

describe('backoffDelay (brief 11: reconnect with backoff)', () => {
  it('doubles from 0.5 s, caps at 30 s and applies jitter', () => {
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, () => 1))).toEqual([500, 1_000, 2_000, 4_000]);
    expect(backoffDelay(20, () => 1)).toBe(30_000);
    expect(backoffDelay(2, () => 0)).toBe(1_000);
  });
});

describe('sessionUrl', () => {
  it('uses the page origin for a relative gateway URL and wss for https', () => {
    expect(sessionUrl('/api', { protocol: 'https:', host: 'lfc.local' })).toBe(
      'wss://lfc.local/ws/session',
    );
    expect(sessionUrl('/api', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws/session',
    );
    expect(sessionUrl('https://gw.example.org/api', { protocol: 'https:', host: 'x' })).toBe(
      'wss://gw.example.org/ws/session',
    );
  });
});

describe('connection store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    useClaims.getState().reset();
  });
  afterEach(() => {
    useConnection.getState().disconnect();
    vi.useRealTimers();
  });

  it('authenticates with the first message and becomes open on session.ready', () => {
    useConnection.getState().connect('wss://lfc.local/ws/session', 'token-123', factory);
    expect(useConnection.getState().status).toBe('connecting');
    last().open();
    expect(JSON.parse(last().sent[0] ?? '')).toEqual({
      type: 'auth',
      schemaVersion: 1,
      token: 'token-123',
    });
    last().receive({ type: 'session.ready', schemaVersion: 1, sessionId: SESSION_ID });
    expect(useConnection.getState()).toMatchObject({ status: 'open', sessionId: SESSION_ID });
  });

  it('reconnects with backoff after a drop and re-authenticates', () => {
    useConnection.getState().connect('wss://lfc.local/ws/session', 'token-123', factory);
    last().open();
    last().receive({ type: 'session.ready', schemaVersion: 1, sessionId: SESSION_ID });
    last().drop();
    expect(useConnection.getState()).toMatchObject({ status: 'reconnecting', sessionId: null });
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(last().sent).toHaveLength(1);
  });

  it('does not reconnect after an unauthorized error', () => {
    useConnection.getState().connect('wss://lfc.local/ws/session', 'wrong', factory);
    last().open();
    last().receive({
      type: 'error',
      schemaVersion: 1,
      code: 'unauthorized',
      message: 'Missing or invalid token',
    });
    last().drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(useConnection.getState().status).toBe('unauthorized');
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('feeds events into the claims store and ignores invalid messages', () => {
    useConnection.getState().connect('wss://lfc.local/ws/session', 't', factory);
    last().open();
    last().receive({ type: 'session.ready', schemaVersion: 1, sessionId: SESSION_ID });
    last().receive({
      type: 'event',
      schemaVersion: 1,
      event: { type: 'claim.checked', schemaVersion: 2, payload: checked() },
    });
    last().receive({
      type: 'event',
      schemaVersion: 1,
      event: { type: 'claim.checked', schemaVersion: 2, payload: { broken: true } },
    });
    last().onmessage?.call(last(), { data: 'not json' });
    expect(useClaims.getState().order).toEqual([CLAIM_ID]);
    expect(useClaims.getState().claims[CLAIM_ID]?.checked?.verdict).toBe('falsch');
  });

  it('reports a missing explanation after the timeout, unless it arrives first', () => {
    useConnection.getState().connect('wss://lfc.local/ws/session', 't', factory);
    last().open();
    last().receive({
      type: 'event',
      schemaVersion: 1,
      event: { type: 'claim.checked', schemaVersion: 2, payload: checked() },
    });
    vi.advanceTimersByTime(EXPLANATION_TIMEOUT_MS - 1);
    expect(useClaims.getState().claims[CLAIM_ID]?.explanationMissing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(useClaims.getState().claims[CLAIM_ID]?.explanationMissing).toBe(true);

    // A late explanation still wins.
    last().receive({
      type: 'event',
      schemaVersion: 1,
      event: { type: 'claim.explained', schemaVersion: 2, payload: explained() },
    });
    expect(useClaims.getState().claims[CLAIM_ID]).toMatchObject({
      explanationMissing: false,
      explained: explained(),
    });
  });
});
