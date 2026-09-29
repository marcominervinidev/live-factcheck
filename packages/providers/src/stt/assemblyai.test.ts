import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { FakeWsServer } from '../testing/fake-ws-server.js';
import { startFakeWsServer } from '../testing/fake-ws-server.js';
import { ASSEMBLYAI_HOSTS, createAssemblyAiProvider } from './assemblyai.js';
import { sttConfigShape } from './config.js';
import type { SttError, SttSegment } from './types.js';

const KEY = 'aai-test-key-never-logged';
const config = {
  ...z.object(sttConfigShape).parse({
    STT_PROVIDER: 'assemblyai',
    STT_MODEL: 'universal-streaming-multilingual',
    ASSEMBLYAI_API_KEY: KEY,
    STT_CONNECT_TIMEOUT_MS: 2_000,
  }),
  ASSEMBLYAI_API_KEY: KEY,
};

const turn = (
  transcript: string,
  endOfTurn: boolean,
  formatted: boolean,
  words: [number, number][] = [],
) => ({
  type: 'Turn',
  turn_order: 0,
  transcript,
  end_of_turn: endOfTurn,
  turn_is_formatted: formatted,
  end_of_turn_confidence: 0.9,
  words: words.map(([start, end]) => ({ start, end, text: 'w', word_is_final: true })),
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

describe('AssemblyAI adapter (ADR 0016)', () => {
  let server: FakeWsServer;
  beforeEach(async () => {
    server = await startFakeWsServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('uses the EU host by default', () => {
    expect(ASSEMBLYAI_HOSTS[config.STT_REGION]).toBe('wss://streaming.eu.assemblyai.com');
  });

  it('connects with the key as header and the v3 parameters', async () => {
    const session = await createAssemblyAiProvider(config, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      collector().handlers,
    );
    const connection = await server.nextConnection();
    const url = new URL(connection.url, 'ws://x');
    expect(url.pathname).toBe('/v3/ws');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sample_rate: '16000',
      encoding: 'pcm_s16le',
      speech_model: 'universal-streaming-multilingual',
      format_turns: 'true',
    });
    expect(connection.headers.authorization).toBe(KEY);
    session.abort();
  });

  it('sends interim turns, skips the unformatted end of turn and delivers the formatted one', async () => {
    const out = collector();
    const session = await createAssemblyAiProvider(config, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    const connection = await server.nextConnection();
    session.send(new Uint8Array(3_200));
    await vi.waitFor(() => {
      expect(connection.binaryBytes).toBe(3_200);
    });
    connection.sendJson({ type: 'Begin', id: 'x' });
    connection.sendJson(turn('die mondlandung', false, false, [[400, 900]]));
    connection.sendJson(turn('die mondlandung fand 1975 statt', true, false, [[400, 2_300]]));
    connection.sendJson(turn('Die Mondlandung fand 1975 statt.', true, true, [[400, 2_300]]));
    connection.sendJson(turn('', false, false));

    await vi.waitFor(() => {
      expect(out.segments).toHaveLength(2);
    });
    expect(out.segments).toEqual([
      { text: 'die mondlandung', isFinal: false, startMs: 400, endMs: 900, speaker: 'A' },
      {
        text: 'Die Mondlandung fand 1975 statt.',
        isFinal: true,
        startMs: 400,
        endMs: 2_300,
        speaker: 'A',
      },
    ]);
    session.abort();
  });

  it('terminates gracefully on finish and reports an unexpected close', async () => {
    const out = collector();
    const session = await createAssemblyAiProvider(config, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      out.handlers,
    );
    const connection = await server.nextConnection();
    connection.socket.on('message', () => {
      connection.socket.close(1000);
    });
    await session.finish();
    expect(connection.json).toEqual([{ type: 'Terminate' }]);
    expect(out.errors).toEqual([]);

    const broken = collector();
    await createAssemblyAiProvider(config, server.origin).open(
      { language: 'de', sampleRate: 16_000 },
      broken.handlers,
    );
    (await server.nextConnection()).socket.close(1011);
    await vi.waitFor(() => {
      expect(broken.errors.map((e) => e.kind)).toEqual(['closed']);
    });
  });

  it('turns a rejected key into an auth error', async () => {
    const rejecting = await startFakeWsServer({ rejectStatus: 403 });
    try {
      await expect(
        createAssemblyAiProvider(config, rejecting.origin).open(
          { language: 'de', sampleRate: 16_000 },
          collector().handlers,
        ),
      ).rejects.toMatchObject({ kind: 'auth' });
    } finally {
      await rejecting.close();
    }
  });
});
