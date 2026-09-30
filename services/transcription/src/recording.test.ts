// Stage 1: one recording on the internal audio socket (ADR 0015) with the mock STT provider and
// hand-written providers at the system boundary. Real WebSockets on a local port, no Redis.
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import type { TranscriptSegment } from '@lfc/contracts';
import type { DailyBudget, SttHandlers, SttProvider } from '@lfc/providers';
import {
  BudgetExceededError,
  MOCK_STT_SCRIPT,
  SttError,
  createMockSttProvider,
} from '@lfc/providers';
import { createLogger } from '@lfc/service-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import type { RecordingDeps } from './recording.js';
import { handleRecording } from './recording.js';

const FRAME = new Uint8Array(3_200);
/** The mock provider finishes one script line every 2 s of audio. */
const FRAMES_PER_LINE = 20;

interface Harness {
  readonly finals: TranscriptSegment[];
  readonly interims: TranscriptSegment[];
  readonly logLines: string[];
}

describe('handleRecording (ADR 0015)', () => {
  let server: WebSocketServer;
  let deps: Partial<RecordingDeps> = {};
  let harness: Harness;

  beforeEach(async () => {
    harness = { finals: [], interims: [], logLines: [] };
    deps = {};
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) =>
      server.once('listening', () => {
        resolve();
      }),
    );
    server.on('connection', (socket) => {
      handleRecording(socket, {
        stt: createMockSttProvider(),
        budget: undefined,
        maxBufferedBytes: 256 * 1024,
        logger: createLogger({
          service: 'transcription',
          level: 'info',
          destination: { write: (line: string) => harness.logLines.push(line) },
        }),
        publishFinal: (segment) => {
          harness.finals.push(segment);
          return Promise.resolve();
        },
        publishInterim: (segment) => {
          harness.interims.push(segment);
          return Promise.resolve();
        },
        ...deps,
      });
    });
  });

  afterEach(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  const connect = async () => {
    const { port } = server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}`);
    const messages: Record<string, unknown>[] = [];
    let closeCode: number | undefined;
    socket.on('message', (data: Buffer) =>
      messages.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>),
    );
    socket.on('close', (code) => {
      closeCode = code;
    });
    await new Promise((resolve) => socket.once('open', resolve));
    return { socket, messages, closeCode: () => closeCode };
  };

  const start = (sessionId = randomUUID(), recordingId = randomUUID()) => ({
    type: 'start',
    schemaVersion: 1,
    sessionId,
    recordingId,
    sampleRate: 16_000,
    encoding: 'pcm16',
    channels: 1,
    language: 'de',
  });

  it('transcribes a recording: ready, interim then final segments with one id, stopped on stop', async () => {
    const client = await connect();
    const message = start();
    client.socket.send(JSON.stringify(message));
    await expect
      .poll(() => client.messages)
      .toEqual([{ type: 'ready', schemaVersion: 1, recordingId: message.recordingId }]);
    for (let i = 0; i < FRAMES_PER_LINE * 2; i++) client.socket.send(FRAME);
    await expect.poll(() => harness.finals.length).toBe(2);
    client.socket.send(JSON.stringify({ type: 'stop', schemaVersion: 1 }));
    await expect.poll(() => client.closeCode()).toBe(1000);

    expect(client.messages.at(-1)).toEqual({
      type: 'stopped',
      schemaVersion: 1,
      recordingId: message.recordingId,
      reason: 'client',
    });
    expect(harness.finals[0]).toMatchObject({
      schemaVersion: 1,
      sessionId: message.sessionId,
      text: MOCK_STT_SCRIPT[0],
      isFinal: true,
      speaker: 'A',
      language: 'de',
      startMs: 0,
      endMs: 2_000,
    });
    expect(harness.finals[1]).toMatchObject({ text: MOCK_STT_SCRIPT[1], speaker: 'B' });
    // Interim and final of the same utterance share the segment id; the next one gets a new id.
    expect(harness.interims.map((s) => s.segmentId)).toEqual(
      harness.finals.map((s) => s.segmentId),
    );
    expect(new Set(harness.finals.map((s) => s.segmentId)).size).toBe(2);
    expect(harness.interims.every((s) => !s.isFinal)).toBe(true);
    // Transcript text never reaches a log line (brief 15.6).
    const logs = harness.logLines.join('\n');
    for (const line of MOCK_STT_SCRIPT.slice(0, 2)) expect(logs).not.toContain(line.slice(0, 20));
    expect(logs).toContain('"audioMs":4000');
  });

  it.each([
    [
      'an invalid first message',
      (s: WebSocket) => {
        s.send('{"type":"hello"}');
      },
    ],
    [
      'binary audio before ready',
      (s: WebSocket) => {
        s.send(FRAME);
      },
    ],
    [
      'a message that is not JSON',
      (s: WebSocket) => {
        s.send('{nope');
      },
    ],
  ])('closes the socket on %s', async (_label, act) => {
    const client = await connect();
    act(client.socket);
    await expect.poll(() => client.closeCode()).toBe(4400);
    expect(harness.finals).toEqual([]);
  });

  it('closes the socket on a second start', async () => {
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    client.socket.send(JSON.stringify(start()));
    await expect.poll(() => client.closeCode()).toBe(4400);
  });

  const provider = (
    overrides: Partial<SttProvider> & { open: SttProvider['open'] },
  ): SttProvider => ({
    name: 'deepgram',
    model: 'nova-3',
    ...overrides,
  });

  it('stops with provider_error when the provider cannot connect or fails later', async () => {
    deps = {
      stt: provider({ open: () => Promise.reject(new SttError('auth', 'rejected')) }),
    };
    const first = await connect();
    first.socket.send(JSON.stringify(start()));
    await expect
      .poll(() => first.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'provider_error' });

    let handlers: SttHandlers | undefined;
    const aborted = vi.fn();
    deps = {
      stt: provider({
        open: (_options, h) => {
          handlers = h;
          return Promise.resolve({
            send: () => undefined,
            bufferedBytes: 0,
            finish: () => Promise.resolve(),
            abort: aborted,
          });
        },
      }),
    };
    const second = await connect();
    second.socket.send(JSON.stringify(start()));
    await expect.poll(() => second.messages.length).toBe(1);
    handlers?.onError(new SttError('closed', 'gone'));
    await expect
      .poll(() => second.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'provider_error' });
  });

  it('stops with overloaded instead of piling up audio when the provider falls behind', async () => {
    const aborted = vi.fn();
    deps = {
      maxBufferedBytes: 16 * 1024,
      stt: provider({
        open: () =>
          Promise.resolve({
            send: () => undefined,
            bufferedBytes: 1_000_000,
            finish: () => Promise.resolve(),
            abort: aborted,
          }),
      }),
    };
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    await expect.poll(() => client.messages.length).toBe(1);
    client.socket.send(FRAME);
    await expect
      .poll(() => client.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'overloaded' });
    expect(aborted).toHaveBeenCalled();
  });

  const budget = (limitUsd: number) => {
    let spent = 0;
    const booked: number[] = [];
    const daily: DailyBudget = {
      ensureAvailable: () =>
        spent >= limitUsd
          ? Promise.reject(new BudgetExceededError(spent, limitUsd))
          : Promise.resolve(),
      record: () => Promise.resolve(),
      recordUsd: (usd) => {
        spent += usd;
        booked.push(usd);
        return Promise.resolve();
      },
    };
    return { daily, booked };
  };

  it('refuses to start a cloud recording when the budget is used up', async () => {
    deps = {
      budget: budget(0).daily,
      stt: provider({ open: () => Promise.reject(new Error('must not be called')) }),
    };
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    await expect
      .poll(() => client.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'budget_exceeded' });
  });

  it('books streamed audio in 10 s steps and stops when the budget runs out', async () => {
    const { daily, booked } = budget(0.001);
    const mock = createMockSttProvider('nova-3');
    deps = { budget: daily, stt: { ...mock, name: 'deepgram', open: mock.open.bind(mock) } };
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    await expect.poll(() => client.messages.length).toBe(1);
    // 10 s of audio: one booking step at Deepgram's list price (0.0077 $/min → ~0.00128 $).
    for (let i = 0; i < 100; i++) client.socket.send(FRAME);
    await expect
      .poll(() => client.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'budget_exceeded' });
    expect(booked[0]).toBeCloseTo((0.0077 * 10) / 60, 8);
  });

  it('refuses to start when the budget cannot be checked (fails closed)', async () => {
    deps = {
      budget: {
        ...budget(10).daily,
        ensureAvailable: () => Promise.reject(new Error('redis unavailable')),
      },
      stt: provider({ open: () => Promise.reject(new Error('must not be called')) }),
    };
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    await expect
      .poll(() => client.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'budget_exceeded' });
  });

  it('stops the recording when audio cannot be booked (fails closed)', async () => {
    const aborted = vi.fn();
    deps = {
      budget: {
        ...budget(10).daily,
        recordUsd: () => Promise.reject(new Error('redis unavailable')),
      },
      stt: provider({
        open: () =>
          Promise.resolve({
            send: () => undefined,
            bufferedBytes: 0,
            finish: () => Promise.resolve(),
            abort: aborted,
          }),
      }),
    };
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    await expect.poll(() => client.messages.length).toBe(1);
    for (let i = 0; i < 100; i++) client.socket.send(FRAME);
    await expect
      .poll(() => client.messages.at(-1))
      .toMatchObject({ type: 'stopped', reason: 'budget_exceeded' });
    expect(aborted).toHaveBeenCalled();
  });

  it('aborts the provider and books the audio when the gateway goes away', async () => {
    const { daily, booked } = budget(10);
    const aborted = vi.fn();
    deps = {
      budget: daily,
      stt: provider({
        open: () =>
          Promise.resolve({
            send: () => undefined,
            bufferedBytes: 0,
            finish: () => Promise.resolve(),
            abort: aborted,
          }),
      }),
    };
    const client = await connect();
    client.socket.send(JSON.stringify(start()));
    await expect.poll(() => client.messages.length).toBe(1);
    for (let i = 0; i < 10; i++) client.socket.send(FRAME);
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.socket.close();
    await expect.poll(() => aborted.mock.calls.length).toBe(1);
    await expect.poll(() => booked.length).toBe(1);
    expect(booked[0]).toBeCloseTo((0.0077 * 1) / 60, 8);
  });
});
