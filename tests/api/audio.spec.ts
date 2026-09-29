// Stage 3 (brief 13.2, ADR 0015): the live audio path through the real stack – browser-like
// WebSocket via Caddy → gateway → transcription (mock STT in the test stack) → transcript events
// back to the session. The mock STT turns every 2 s of audio into one scripted German sentence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { Message } from './session.js';
import { openSession } from './session.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/audio/conversation.de.wav', import.meta.url));
const FRAME_BYTES = 3_200;

/** PCM data of the fixture (16 kHz mono PCM16 after a 44-byte header, see its README). */
const pcm = readFileSync(FIXTURE).subarray(44);

const START = JSON.stringify({
  type: 'audio.start',
  schemaVersion: 2,
  sampleRate: 16_000,
  encoding: 'pcm16',
  channels: 1,
  language: 'de',
});

const segments = (messages: Message[]) =>
  messages
    .filter((m) => m.type === 'event' && m.event?.type === 'transcript.segment')
    .map((m) => m.event?.payload as { isFinal: boolean; text: string; speaker: string });

test('streams audio and receives interim and final transcript segments', async ({ baseURL }) => {
  const { socket, messages } = await openSession(baseURL ?? '');
  try {
    socket.send(START);
    await expect.poll(() => messages.at(-1)?.type).toBe('audio.started');

    // 4 s of the fixture in 100 ms frames, paced below the frame-rate limit (20/s).
    for (let offset = 0; offset < 40 * FRAME_BYTES; offset += FRAME_BYTES) {
      socket.send(pcm.subarray(offset, offset + FRAME_BYTES));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await expect.poll(() => segments(messages).filter((s) => s.isFinal).length).toBe(2);
    const all = segments(messages);
    expect(all.map((s) => s.isFinal)).toEqual([false, true, false, true]);
    expect(all.filter((s) => s.isFinal).map((s) => s.speaker)).toEqual(['A', 'B']);
    expect(all[1]?.text).toBe('Guten Abend und willkommen zur Diskussion.');

    socket.send(JSON.stringify({ type: 'audio.stop', schemaVersion: 2 }));
    await expect
      .poll(() => messages.at(-1))
      .toMatchObject({ type: 'audio.stopped', reason: 'client' });
  } finally {
    socket.close();
  }
});

test('refuses audio before audio.start without ending the session', async ({ baseURL }) => {
  const { socket, messages } = await openSession(baseURL ?? '');
  let closed = false;
  socket.on('close', () => {
    closed = true;
  });
  try {
    socket.send(pcm.subarray(0, FRAME_BYTES));
    await expect
      .poll(() => messages.at(-1))
      .toMatchObject({ type: 'error', code: 'audio_not_started' });
    socket.send(START);
    await expect.poll(() => messages.at(-1)?.type).toBe('audio.started');
    expect(closed).toBe(false);
  } finally {
    socket.close();
  }
});

test('ends a recording that bursts audio faster than real time', async ({ baseURL }) => {
  const { socket, messages } = await openSession(baseURL ?? '');
  try {
    socket.send(START);
    await expect.poll(() => messages.at(-1)?.type).toBe('audio.started');
    // 101 frames at once – not a microphone. In the real stack either the frame-rate limit or
    // the backpressure guard fires first (timing); both end the recording with `overloaded`.
    // Which error code comes with it is covered deterministically in the gateway's stage 2a.
    for (let i = 0; i < 101; i++) socket.send(pcm.subarray(0, FRAME_BYTES));
    await expect
      .poll(() => messages.find((m) => m.type === 'audio.stopped'))
      .toMatchObject({ type: 'audio.stopped', reason: 'overloaded' });
    // The session survives: a new recording can start.
    socket.send(START);
    await expect.poll(() => messages.filter((m) => m.type === 'audio.started').length).toBe(2);
  } finally {
    socket.close();
  }
});
