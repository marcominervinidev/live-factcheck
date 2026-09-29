import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { FakeWsServer } from '../testing/fake-ws-server.js';
import { startFakeWsServer } from '../testing/fake-ws-server.js';
import { sttConfigShape } from './config.js';
import { createLocalSttProvider } from './local.js';
import type { SttError, SttSegment } from './types.js';

function collector() {
  const segments: SttSegment[] = [];
  const errors: SttError[] = [];
  return {
    segments,
    errors,
    handlers: {
      onSegment: (segment: SttSegment) => segments.push(segment),
      onError: (error: SttError) => errors.push(error),
    },
  };
}

describe('stt-local adapter (brief 10, ADR 0016)', () => {
  let server: FakeWsServer;
  let url: string;
  beforeEach(async () => {
    server = await startFakeWsServer();
    url = `${server.origin}/v1/stream`;
  });
  afterEach(async () => {
    await server.close();
  });

  const provider = () => {
    const config = z.object(sttConfigShape).parse({
      STT_PROVIDER: 'local',
      STT_MODEL: 'small',
      LOCAL_STT_URL: url,
      STT_CONNECT_TIMEOUT_MS: 2_000,
    });
    return createLocalSttProvider({ ...config, LOCAL_STT_URL: url });
  };

  it('starts with the format, forwards audio and segments, and stops on finish', async () => {
    const out = collector();
    const session = await provider().open({ language: 'de', sampleRate: 16_000 }, out.handlers);
    const connection = await server.nextConnection();
    session.send(new Uint8Array(3_200));
    await vi.waitFor(() => {
      expect(connection.binaryBytes).toBe(3_200);
    });
    expect(connection.json[0]).toEqual({ type: 'start', sampleRate: 16_000, language: 'de' });

    connection.sendJson({
      type: 'segment',
      text: ' Der Krieg',
      isFinal: false,
      startMs: 0,
      endMs: 800,
    });
    connection.sendJson({ type: 'segment', text: '  ', isFinal: false, startMs: 0, endMs: 900 });
    connection.sendJson({
      type: 'segment',
      text: 'Der Krieg endete 1965.',
      isFinal: true,
      startMs: 0,
      endMs: 2_100,
    });
    connection.socket.on('message', () => {
      connection.socket.close(1000);
    });
    await vi.waitFor(() => {
      expect(out.segments).toHaveLength(2);
    });
    await session.finish();

    expect(out.segments).toEqual([
      { text: 'Der Krieg', isFinal: false, startMs: 0, endMs: 800, speaker: 'A' },
      { text: 'Der Krieg endete 1965.', isFinal: true, startMs: 0, endMs: 2_100, speaker: 'A' },
    ]);
    expect(connection.json.at(-1)).toEqual({ type: 'stop' });
    expect(out.errors).toEqual([]);
  });

  it.each([
    [
      'an error message',
      { type: 'error', message: 'model not loaded' },
      'stt-local: model not loaded',
    ],
    ['an invalid message', { type: 'segment', text: 'x' }, 'stt-local sent an invalid message'],
  ])('fails the stream on %s', async (_label, message, expected) => {
    const out = collector();
    await provider().open({ language: 'de', sampleRate: 16_000 }, out.handlers);
    (await server.nextConnection()).sendJson(message);
    await vi.waitFor(() => {
      expect(out.errors.map((e) => [e.kind, e.message])).toEqual([['protocol', expected]]);
    });
  });

  it('reports a server that goes away, and cannot connect to a closed port', async () => {
    const out = collector();
    await provider().open({ language: 'de', sampleRate: 16_000 }, out.handlers);
    (await server.nextConnection()).socket.terminate();
    await vi.waitFor(() => {
      expect(out.errors.map((e) => e.kind)).toEqual(['closed']);
    });

    url = 'ws://127.0.0.1:9/v1/stream';
    await expect(
      provider().open({ language: 'de', sampleRate: 16_000 }, collector().handlers),
    ).rejects.toMatchObject({ kind: 'connect' });
  });
});
