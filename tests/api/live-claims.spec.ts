// Stage 3 (brief 6, 13.2; ADR 0015, 0017): the whole live path through the real stack with mock
// providers – audio → transcription → transcript.segments → claim-extractor → claims.detected →
// fact-checker → claims.checked, all pushed back to the session. The mock STT turns 2 s of audio
// into one scripted sentence: a greeting (dropped by the pre-filter), then "Der Zweite Weltkrieg
// endete 1965." (a claim the mock fact-checker rates as false).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { Message } from './session.js';
import { openSession } from './session.js';

const pcm = readFileSync(
  fileURLToPath(new URL('../fixtures/audio/conversation.de.wav', import.meta.url)),
).subarray(44);
const FRAME_BYTES = 3_200;

const payloads = (messages: Message[], type: string) =>
  messages.filter((m) => m.type === 'event' && m.event?.type === type).map((m) => m.event?.payload);

test('a spoken false claim becomes a card: detected, then checked as false', async ({
  baseURL,
}) => {
  const { socket, messages, sessionId } = await openSession(baseURL ?? '');
  try {
    socket.send(
      JSON.stringify({
        type: 'audio.start',
        schemaVersion: 2,
        sampleRate: 16_000,
        encoding: 'pcm16',
        channels: 1,
        language: 'de',
      }),
    );
    await expect.poll(() => messages.at(-1)?.type).toBe('audio.started');
    // 4 s: the greeting and the claim, paced below the frame-rate limit.
    for (let offset = 0; offset < 40 * FRAME_BYTES; offset += FRAME_BYTES) {
      socket.send(pcm.subarray(offset, offset + FRAME_BYTES));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    socket.send(JSON.stringify({ type: 'audio.stop', schemaVersion: 2 }));

    await expect
      .poll(() => payloads(messages, 'claim.detected').length, { timeout: 15_000 })
      .toBe(1);
    const detected = payloads(messages, 'claim.detected')[0] ?? {};
    expect(detected).toMatchObject({
      sessionId,
      standaloneText: 'Der Zweite Weltkrieg endete 1965.',
      speaker: 'B',
    });
    // The greeting was dropped: only one claim from two final segments.
    expect(
      payloads(messages, 'transcript.segment').filter((s) => s?.['isFinal'] === true),
    ).toHaveLength(2);

    await expect
      .poll(() => payloads(messages, 'claim.checked').length, { timeout: 15_000 })
      .toBe(1);
    expect(payloads(messages, 'claim.checked')[0]).toMatchObject({
      claimId: detected['claimId'],
      verdict: 'falsch',
    });
  } finally {
    socket.close();
  }
});
