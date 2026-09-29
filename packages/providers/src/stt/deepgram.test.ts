import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { FakeWsServer } from '../testing/fake-ws-server.js';
import { startFakeWsServer } from '../testing/fake-ws-server.js';
import { sttConfigShape } from './config.js';
import { DEEPGRAM_HOSTS, createDeepgramProvider } from './deepgram.js';
import type { SttError, SttSegment } from './types.js';

const KEY = 'dg-test-key-never-logged';
const config = z.object(sttConfigShape).parse({
  STT_PROVIDER: 'deepgram',
  STT_MODEL: 'nova-3',
  DEEPGRAM_API_KEY: KEY,
  STT_CONNECT_TIMEOUT_MS: 2_000,
});
const deepgramConfig = { ...config, DEEPGRAM_API_KEY: KEY };

const results = (
  transcript: string,
  flags: { isFinal: boolean; speechFinal?: boolean },
  start: number,
  duration: number,
  speakers: number[] = [],
) => ({
  type: 'Results',
  is_final: flags.isFinal,
  speech_final: flags.speechFinal ?? false,
  start,
  duration,
  channel: {
    alternatives: [{ transcript, words: speakers.map((speaker) => ({ word: 'w', speaker })) }],
  },
});

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

describe('Deepgram adapter (ADR 0016)', () => {
  let server: FakeWsServer;
  beforeEach(async () => {
    server = await startFakeWsServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('uses the EU host by default', () => {
    expect(DEEPGRAM_HOSTS[config.STT_REGION]).toBe('wss://api.eu.deepgram.com');
  });

  it('connects with the key as header and the documented parameters, incl. the MIP opt-out', async () => {
    const provider = createDeepgramProvider(deepgramConfig, server.origin);
    const session = await provider.open(
      { language: 'de', sampleRate: 16_000 },
      collector().handlers,
    );
    const connection = await server.nextConnection();

    expect(connection.headers.authorization).toBe(`Token ${KEY}`);
    const params = new URL(connection.url, 'ws://x').searchParams;
    expect(new URL(connection.url, 'ws://x').pathname).toBe('/v1/listen');
    expect(Object.fromEntries(params)).toMatchObject({
      model: 'nova-3',
      language: 'de',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      diarize: 'true',
      endpointing: '300',
      mip_opt_out: 'true',
    });
    expect(connection.url).not.toContain(KEY);
    session.abort();
  });

  it('forwards audio and turns is_final parts into one final segment at speech_final', async () => {
    const out = collector();
    const session = await createDeepgramProvider(deepgramConfig, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    const connection = await server.nextConnection();
    session.send(new Uint8Array(3_200));
    await vi.waitFor(() => {
      expect(connection.binaryBytes).toBe(3_200);
    });

    connection.sendJson(results('Der Zweite', { isFinal: false }, 0.5, 0.6, [1, 1]));
    connection.sendJson(results('Der Zweite Weltkrieg', { isFinal: true }, 0.5, 1.2, [1, 1, 1]));
    connection.sendJson(results('endete 1965.', { isFinal: false }, 1.7, 0.8, [1, 1]));
    connection.sendJson(
      results('endete 1965.', { isFinal: true, speechFinal: true }, 1.7, 0.9, [1, 0]),
    );

    await vi.waitFor(() => {
      expect(out.segments).toHaveLength(3);
    });
    expect(out.segments[0]).toEqual({
      text: 'Der Zweite',
      isFinal: false,
      startMs: 500,
      endMs: 1_100,
      speaker: 'A',
    });
    expect(out.segments[1]).toMatchObject({
      text: 'Der Zweite Weltkrieg endete 1965.',
      isFinal: false,
    });
    expect(out.segments[2]).toEqual({
      text: 'Der Zweite Weltkrieg endete 1965.',
      isFinal: true,
      startMs: 500,
      endMs: 2_600,
      speaker: 'A',
    });
    session.abort();
  });

  it('labels speakers A, B, … in order of appearance', async () => {
    const out = collector();
    const session = await createDeepgramProvider(deepgramConfig, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    const connection = await server.nextConnection();
    connection.sendJson(results('Erster Satz.', { isFinal: true, speechFinal: true }, 0, 1, [3]));
    connection.sendJson(results('Zweiter Satz.', { isFinal: true, speechFinal: true }, 1, 1, [0]));
    connection.sendJson(results('Dritter Satz.', { isFinal: true, speechFinal: true }, 2, 1, [3]));
    await vi.waitFor(() => {
      expect(out.segments.map((s) => s.speaker)).toEqual(['A', 'B', 'A']);
    });
    session.abort();
  });

  it('flushes pending parts on UtteranceEnd and ignores unknown or malformed messages', async () => {
    const out = collector();
    const session = await createDeepgramProvider(deepgramConfig, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    const connection = await server.nextConnection();
    connection.socket.send('{not json');
    connection.sendJson({ type: 'Metadata', request_id: 'x' });
    connection.sendJson(results('Berlin hat vier Millionen Einwohner.', { isFinal: true }, 0, 2));
    connection.sendJson(results('', { isFinal: true }, 2, 1));
    expect(out.segments).toHaveLength(0);
    connection.sendJson({ type: 'UtteranceEnd', last_word_end: 2 });
    await vi.waitFor(() => {
      expect(out.segments).toEqual([
        {
          text: 'Berlin hat vier Millionen Einwohner.',
          isFinal: true,
          startMs: 0,
          endMs: 2_000,
          speaker: 'A',
        },
      ]);
    });
    session.abort();
  });

  it('finishes with Finalize and CloseStream and delivers what is still pending', async () => {
    const out = collector();
    const session = await createDeepgramProvider(deepgramConfig, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    const connection = await server.nextConnection();
    connection.sendJson(results('Letzte Worte.', { isFinal: true }, 0, 1));
    connection.socket.on('message', () => {
      if (connection.json.some((m) => (m as { type?: string }).type === 'CloseStream')) {
        connection.socket.close(1000);
      }
    });
    await session.finish();

    expect(connection.json).toEqual([{ type: 'Finalize' }, { type: 'CloseStream' }]);
    expect(out.segments).toEqual([
      { text: 'Letzte Worte.', isFinal: true, startMs: 0, endMs: 1_000, speaker: 'A' },
    ]);
    expect(out.errors).toEqual([]);
    session.send(new Uint8Array(10));
    expect(connection.binaryBytes).toBe(0);
  });

  it('reports an unexpected close as an error, and nothing after an abort', async () => {
    const out = collector();
    await createDeepgramProvider(deepgramConfig, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    (await server.nextConnection()).socket.close(1011);
    await vi.waitFor(() => {
      expect(out.errors.map((e) => e.kind)).toEqual(['closed']);
    });

    const aborted = collector();
    const session = await createDeepgramProvider(deepgramConfig, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      aborted.handlers,
    );
    const connection = await server.nextConnection();
    connection.sendJson(results('Halber Satz', { isFinal: true }, 0, 1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    session.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aborted.segments).toEqual([]);
    expect(aborted.errors).toEqual([]);
  });

  it('turns a rejected key into an auth error without the key in the message', async () => {
    const rejecting = await startFakeWsServer({ rejectStatus: 401 });
    try {
      const error = await createDeepgramProvider(deepgramConfig, rejecting.origin)
        .open({ language: 'de', sampleRate: 16_000 }, collector().handlers)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'SttError', kind: 'auth' });
      expect((error as Error).message).not.toContain(KEY);
    } finally {
      await rejecting.close();
    }
  });

  it('reports an unreachable host as a connect error', async () => {
    const error = await createDeepgramProvider(deepgramConfig, 'ws://127.0.0.1:9')
      .open({ language: 'de', sampleRate: 16_000 }, collector().handlers)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'SttError', kind: 'connect' });
  });
});
