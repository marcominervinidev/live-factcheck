import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FakeWsServer } from '../testing/fake-ws-server.js';
import { startFakeWsServer } from '../testing/fake-ws-server.js';
import { closed, keepAlive, openSocket, parseJson } from './socket.js';

describe('parseJson', () => {
  it.each([
    ['a buffer', Buffer.from('{"a":1}'), false, { a: 1 }],
    ['fragments', [Buffer.from('{"a":'), Buffer.from('2}')], false, { a: 2 }],
    ['an ArrayBuffer', new TextEncoder().encode('{"a":3}').buffer, false, { a: 3 }],
    ['binary audio', Buffer.from([1, 2, 3]), true, undefined],
    ['malformed JSON', Buffer.from('{no'), false, undefined],
  ])('handles %s', (_label, data, isBinary, expected) => {
    expect(parseJson(data, isBinary)).toEqual(expected);
  });
});

describe('socket lifecycle', () => {
  let server: FakeWsServer;
  beforeEach(async () => {
    server = await startFakeWsServer();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await server.close();
  });

  it('terminates a socket that does not close in time', async () => {
    const socket = await openSocket(server.origin, {}, 2_000);
    await server.nextConnection();
    const started = Date.now();
    await closed(socket, 50);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    await closed(socket, 50);
  });

  it('sends keep-alives only while no audio went out', async () => {
    const socket = await openSocket(server.origin, {}, 2_000);
    const connection = await server.nextConnection();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    let lastSentAt = Date.now();
    const stop = keepAlive(socket, '{"type":"KeepAlive"}', () => lastSentAt, 1_000);

    // t = 1000: nothing sent for a full interval → keep-alive.
    vi.advanceTimersByTime(1_000);
    // t = 1800: audio goes out; the tick at t = 2000 sees it 200 ms old → no keep-alive.
    vi.advanceTimersByTime(800);
    lastSentAt = Date.now();
    vi.advanceTimersByTime(200);
    stop();
    vi.advanceTimersByTime(5_000);
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(connection.json).toEqual([{ type: 'KeepAlive' }]);
    });
    socket.terminate();
  });
});
