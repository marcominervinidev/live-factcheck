// Dev tool for plan task T2.5 (`make stt-probe`): streams a WAV file in real time through the
// configured STT provider and prints every segment with its latency (time from the end of the
// spoken words to the arrival of the final segment). Talks to the provider only – no Redis, no
// stack. Prints transcript text on purpose: it runs only on our own synthetic test audio.
import { readFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SttSegment } from '@lfc/providers';
import {
  STT_SECRET_KEYS,
  checkSttConfig,
  createSttProvider,
  describeSttConfig,
  sttConfigShape,
} from '@lfc/providers';
import { loadConfig } from '@lfc/service-kit';
import { z } from 'zod';

const FRAME_BYTES = 3_200;
const FRAME_MS = 100;

/** The PCM data of a 16 kHz mono 16-bit WAV file; anything else is rejected. */
function pcmFromWav(path: string): Buffer {
  const file = readFileSync(path);
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a WAV file`);
  }
  let offset = 12;
  let format: { rate: number; channels: number; bits: number } | undefined;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        channels: file.readUInt16LE(body + 2),
        rate: file.readUInt32LE(body + 4),
        bits: file.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (format?.rate !== 16_000 || format.channels !== 1 || format.bits !== 16) {
        throw new Error(`${path}: need 16 kHz mono 16-bit PCM, got ${JSON.stringify(format)}`);
      }
      return file.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

/** Only the committed audio fixtures can be played, never an arbitrary path (Sonar S8707). */
const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/audio/', import.meta.url));
const name = process.argv[2];
if (name === undefined) throw new Error('usage: probe.ts <fixture.wav>');
const path = resolve(FIXTURES, basename(name));
if (
  !path.startsWith(FIXTURES.endsWith(sep) ? FIXTURES : FIXTURES + sep) ||
  !path.endsWith('.wav')
) {
  throw new Error(`not an audio fixture: ${name}`);
}
const { config } = loadConfig(z.object(sttConfigShape).superRefine(checkSttConfig), {
  secretKeys: [...STT_SECRET_KEYS],
});
const pcm = pcmFromWav(path);
const provider = createSttProvider(config);
const described = describeSttConfig(config);
console.log(JSON.stringify({ probe: described, audioMs: (pcm.length / 32_000) * 1_000 }));

const finals: (SttSegment & { latencyMs: number })[] = [];
// An object, so the check in the loop sees updates made by the error callback.
const state = { failed: false };
let startedAt = 0;
const session = await provider.open(
  { language: config.STT_LANGUAGE, sampleRate: 16_000 },
  {
    onSegment: (segment) => {
      // Wall-clock arrival minus the moment the segment's last word was sent.
      const latencyMs = Math.round(Date.now() - (startedAt + segment.endMs));
      console.log(JSON.stringify({ ...segment, latencyMs }));
      if (segment.isFinal) finals.push({ ...segment, latencyMs });
    },
    onError: (error) => {
      state.failed = true;
      console.error(JSON.stringify({ error: error.kind, message: error.message }));
    },
  },
);

startedAt = Date.now();
for (let offset = 0; offset < pcm.length && !state.failed; offset += FRAME_BYTES) {
  session.send(pcm.subarray(offset, offset + FRAME_BYTES));
  const due = startedAt + ((offset + FRAME_BYTES) / FRAME_BYTES) * FRAME_MS;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, due - Date.now())));
}
await session.finish();

const latencies = finals.map((f) => f.latencyMs).sort((a, b) => a - b);
console.log(
  JSON.stringify({
    summary: {
      finals: finals.length,
      speakers: [...new Set(finals.map((f) => f.speaker))],
      latencyMs: {
        median: latencies[Math.floor(latencies.length / 2)] ?? null,
        max: latencies.at(-1) ?? null,
      },
    },
  }),
);
process.exit(state.failed ? 1 : 0);
