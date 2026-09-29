// Stage 1: the gateway's audio channel (ADR 0015) against a fake `transcription` WebSocket at
// the internal system boundary. Real sockets on a local port, no Redis.
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import type { WsServerMessage } from '@lfc/contracts';
import { silentLogger } from '@lfc/service-kit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import type { AudioOptions } from './audio.js';
import { DEFAULT_AUDIO_OPTIONS, audioChannel } from './audio.js';

const START = {
  type: 'audio.start',
  schemaVersion: 2,
  sampleRate: 16_000,
  encoding: 'pcm16',
  channels: 1,
  language: 'de',
} as const;
const FRAME = Buffer.alloc(3_200);

interface Fake {
  socket: WebSocket;
  json: Record<string, unknown>[];
  binaryBytes: number;
}

describe('audioChannel (ADR 0015)', () => {
  let server: WebSocketServer;
  let fakes: Fake[];
  /** How the fake transcription answers `start`: `ready` by default. */
  let onStart: (fake: Fake, start: Record<string, unknown>) => void;

  beforeEach(async () => {
    fakes = [];
    onStart = (fake, start) => {
      fake.socket.send(
        JSON.stringify({ type: 'ready', schemaVersion: 1, recordingId: start['recordingId'] }),
      );
    };
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) =>
      server.once('listening', () => {
        resolve();
      }),
    );
    server.on('connection', (socket) => {
      const fake: Fake = { socket, json: [], binaryBytes: 0 };
      fakes.push(fake);
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          fake.binaryBytes += data.byteLength;
          return;
        }
        const message = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        fake.json.push(message);
        if (message['type'] === 'start') onStart(fake, message);
      });
    });
  });

  afterEach(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  const channel = (overrides: Partial<AudioOptions> = {}) => {
    const sent: WsServerMessage[] = [];
    const { port } = server.address() as AddressInfo;
    const sessionId = randomUUID();
    const audio = audioChannel(
      sessionId,
      (message) => sent.push(message),
      {
        ...DEFAULT_AUDIO_OPTIONS,
        transcriptionUrl: `ws://127.0.0.1:${String(port)}/v1/audio`,
        maxRecordingMs: 60_000,
        ...overrides,
      },
      silentLogger(),
    );
    return { audio, sent, sessionId };
  };

  const started = async (overrides: Partial<AudioOptions> = {}) => {
    const c = channel(overrides);
    c.audio.start(START);
    await vi.waitFor(() => {
      expect(c.sent.at(-1)).toMatchObject({ type: 'audio.started' });
    });
    const recordingId = (c.sent.at(-1) as { recordingId: string }).recordingId;
    const fake = fakes.at(-1);
    if (fake === undefined) throw new Error('no connection to transcription');
    return { ...c, recordingId, fake };
  };

  it('starts a recording, forwards frames and ends it with the reason from transcription', async () => {
    const { audio, sent, sessionId, recordingId, fake } = await started();
    expect(fake.json[0]).toEqual({
      ...START,
      type: 'start',
      schemaVersion: 1,
      sessionId,
      recordingId,
    });

    audio.frame(FRAME);
    audio.frame(FRAME);
    await vi.waitFor(() => {
      expect(fake.binaryBytes).toBe(6_400);
    });
    audio.stop();
    await vi.waitFor(() => {
      expect(fake.json.at(-1)).toEqual({ type: 'stop', schemaVersion: 1 });
    });
    fake.socket.send(
      JSON.stringify({ type: 'stopped', schemaVersion: 1, recordingId, reason: 'client' }),
    );
    await vi.waitFor(() => {
      expect(sent.at(-1)).toEqual({
        type: 'audio.stopped',
        schemaVersion: 2,
        recordingId,
        reason: 'client',
      });
    });
    // A new recording is possible afterwards.
    audio.start(START);
    await vi.waitFor(() => {
      expect(sent.filter((m) => m.type === 'audio.started')).toHaveLength(2);
    });
    audio.close();
  });

  it.each([['budget_exceeded'], ['overloaded'], ['provider_error']] as const)(
    'forwards a stop by transcription (%s)',
    async (reason) => {
      const { sent, recordingId, fake } = await started();
      fake.socket.send(JSON.stringify({ type: 'stopped', schemaVersion: 1, recordingId, reason }));
      await vi.waitFor(() => {
        expect(sent.at(-1)).toEqual({
          type: 'audio.stopped',
          schemaVersion: 2,
          recordingId,
          reason,
        });
      });
    },
  );

  it('refuses a second start and frames outside a recording, without ending anything', async () => {
    const idle = channel();
    idle.audio.frame(FRAME);
    idle.audio.stop();
    expect(idle.sent.map((m) => (m.type === 'error' ? m.code : m.type))).toEqual([
      'audio_not_started',
      'audio_not_started',
    ]);

    const { audio, sent } = await started();
    audio.start(START);
    expect(sent.at(-1)).toMatchObject({ type: 'error', code: 'audio_already_started' });
    audio.close();
  });

  it('drops an oversized frame with an error and keeps recording', async () => {
    const { audio, sent, fake } = await started();
    audio.frame(Buffer.alloc(8 * 1024 + 1));
    audio.frame(FRAME);
    await vi.waitFor(() => {
      expect(fake.binaryBytes).toBe(3_200);
    });
    expect(sent.at(-1)).toMatchObject({ type: 'error', code: 'frame_too_large' });
    expect(sent.some((m) => m.type === 'audio.stopped')).toBe(false);
    audio.close();
  });

  it('stops a recording that sends faster than real time', async () => {
    const { audio, sent, recordingId } = await started({ rateWindowMs: 1_000 });
    for (let i = 0; i < 21; i++) audio.frame(FRAME);
    expect(sent.slice(-2)).toEqual([
      expect.objectContaining({ type: 'error', code: 'frame_rate_exceeded' }),
      { type: 'audio.stopped', schemaVersion: 2, recordingId, reason: 'overloaded' },
    ]);
  });

  it('stops with overloaded instead of buffering when the internal socket is backed up', async () => {
    const { audio, sent, recordingId } = await started({ maxBufferedBytes: -1 });
    audio.frame(FRAME);
    expect(sent.at(-1)).toEqual({
      type: 'audio.stopped',
      schemaVersion: 2,
      recordingId,
      reason: 'overloaded',
    });
  });

  it('ends a recording at the recording limit', async () => {
    const { sent, recordingId } = await started({ maxRecordingMs: 100 });
    await vi.waitFor(() => {
      expect(sent.at(-1)).toEqual({
        type: 'audio.stopped',
        schemaVersion: 2,
        recordingId,
        reason: 'recording_limit',
      });
    });
  });

  it.each([
    ['is unreachable', { transcriptionUrl: 'ws://127.0.0.1:9/v1/audio' }, () => undefined],
    ['does not answer in time', { answerTimeoutMs: 100 }, () => undefined],
    [
      'answers for another recording',
      {},
      (fake: Fake) => {
        fake.socket.send(
          JSON.stringify({ type: 'ready', schemaVersion: 1, recordingId: randomUUID() }),
        );
      },
    ],
    [
      'closes the connection',
      {},
      (fake: Fake) => {
        fake.socket.close();
      },
    ],
  ] as const)('reports provider_error when transcription %s', async (_label, overrides, answer) => {
    onStart = answer;
    const { audio, sent } = channel(overrides);
    audio.start(START);
    await vi.waitFor(() => {
      expect(sent.at(-1)).toMatchObject({ type: 'audio.stopped', reason: 'provider_error' });
    });
    expect(sent.some((m) => m.type === 'audio.started')).toBe(false);
  });

  it('cancels a recording that is still starting, and closes silently with the session', async () => {
    onStart = () => undefined;
    const starting = channel();
    starting.audio.start(START);
    await vi.waitFor(() => {
      expect(fakes).toHaveLength(1);
    });
    starting.audio.stop();
    expect(starting.sent.at(-1)).toMatchObject({ type: 'audio.stopped', reason: 'client' });

    onStart = (fake, start) => {
      fake.socket.send(
        JSON.stringify({ type: 'ready', schemaVersion: 1, recordingId: start['recordingId'] }),
      );
    };
    const { audio, sent, fake } = await started();
    const count = sent.length;
    audio.close();
    await vi.waitFor(() => {
      expect(fake.socket.readyState).toBe(fake.socket.CLOSED);
    });
    expect(sent).toHaveLength(count);
  });
});
