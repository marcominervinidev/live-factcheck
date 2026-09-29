// Deepgram live transcription over the documented WebSocket protocol with `ws`, not the SDK: the
// EU host, headers and a fake server in tests are straightforward this way, and the image needs
// no extra SDK (ADR 0016, `.ai/research/stt-providers.md`).
import type WebSocket from 'ws';
import { z } from 'zod';

import type { SttConfig } from './config.js';
import { closed, keepAlive, openSocket, parseJson } from './socket.js';
import type { SttHandlers, SttOpenOptions, SttProvider, SttSession } from './types.js';
import { SttError, speakerLabels } from './types.js';

export const DEEPGRAM_HOSTS = {
  eu: 'wss://api.eu.deepgram.com',
  us: 'wss://api.deepgram.com',
} as const;

const Word = z.object({ speaker: z.number().int().nonnegative().optional() });

const Results = z.object({
  type: z.literal('Results'),
  is_final: z.boolean(),
  speech_final: z.boolean(),
  start: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  channel: z.object({
    alternatives: z
      .array(z.object({ transcript: z.string(), words: z.array(Word).default([]) }))
      .min(1),
  }),
});

const UtteranceEnd = z.object({ type: z.literal('UtteranceEnd') });

/** A finalized part that ends a sentence (German punctuation from `punctuate`). */
const SENTENCE_END = /[.!?…]["»“”')]*$/;

interface Part {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speakers: readonly (number | undefined)[];
}

/** The most frequent speaker id of the words, `undefined` without diarization. */
function majority(ids: readonly (number | undefined)[]): number | undefined {
  const counts = new Map<number, number>();
  for (const id of ids) if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function listenUrl(config: SttConfig, options: SttOpenOptions, host: string): string {
  const params = new URLSearchParams({
    model: config.STT_MODEL,
    language: options.language,
    encoding: 'linear16',
    sample_rate: String(options.sampleRate),
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    diarize: 'true',
    endpointing: String(config.STT_ENDPOINTING_MS),
    utterance_end_ms: '1000',
    vad_events: 'true',
    // Our audio must not be used to train Deepgram's models (ADR 0016).
    mip_opt_out: 'true',
  });
  return `${host}/v1/listen?${params.toString()}`;
}

export function createDeepgramProvider(
  config: SttConfig & { DEEPGRAM_API_KEY: string },
  host: string = DEEPGRAM_HOSTS[config.STT_REGION],
): SttProvider {
  return {
    name: 'deepgram',
    model: config.STT_MODEL,
    async open(options, handlers) {
      const socket = await openSocket(
        listenUrl(config, options, host),
        { authorization: `Token ${config.DEEPGRAM_API_KEY}` },
        config.STT_CONNECT_TIMEOUT_MS,
      );
      return deepgramSession(socket, handlers);
    },
  };
}

function deepgramSession(socket: WebSocket, handlers: SttHandlers): SttSession {
  const label = speakerLabels();
  let parts: Part[] = [];
  let lastSentAt = Date.now();
  let ending = false;
  let aborted = false;
  let done = false;

  const emitFinal = () => {
    if (parts.length === 0) return;
    const text = parts.map((p) => p.text).join(' ');
    const first = parts[0];
    const last = parts.at(-1);
    const speaker = label(majority(parts.flatMap((p) => p.speakers)));
    parts = [];
    if (first === undefined || last === undefined) return;
    handlers.onSegment({
      text,
      isFinal: true,
      startMs: first.startMs,
      endMs: last.endMs,
      speaker,
    });
  };

  socket.on('message', (data, isBinary) => {
    const json = parseJson(data, isBinary);
    const results = Results.safeParse(json);
    if (results.success) {
      const alternative = results.data.channel.alternatives[0];
      const transcript = alternative?.transcript.trim() ?? '';
      const startMs = Math.round(results.data.start * 1_000);
      const endMs = Math.round((results.data.start + results.data.duration) * 1_000);
      const speakers = alternative?.words.map((w) => w.speaker) ?? [];
      if (results.data.is_final) {
        if (transcript !== '') parts.push({ text: transcript, startMs, endMs, speakers });
        // A finished sentence is final at once: waiting for Deepgram's end of utterance merged
        // several sentences and speakers into one segment in the real test (T2.5).
        if (results.data.speech_final || SENTENCE_END.test(transcript)) emitFinal();
      } else if (transcript !== '') {
        const pending = parts.map((p) => p.text);
        handlers.onSegment({
          text: [...pending, transcript].join(' '),
          isFinal: false,
          startMs: parts[0]?.startMs ?? startMs,
          endMs,
          speaker: label(majority([...parts.flatMap((p) => p.speakers), ...speakers])),
        });
      }
      return;
    }
    if (UtteranceEnd.safeParse(json).success) emitFinal();
  });

  const stopKeepAlive = keepAlive(socket, JSON.stringify({ type: 'KeepAlive' }), () => lastSentAt);

  socket.on('close', () => {
    stopKeepAlive();
    // After abort nothing is delivered any more; after finish the last words still count.
    if (!aborted) emitFinal();
    if (!ending && !done) {
      done = true;
      handlers.onError(new SttError('closed', 'Deepgram closed the stream'));
    }
    done = true;
  });
  socket.on('error', (error) => {
    if (!done) {
      done = true;
      handlers.onError(new SttError('closed', 'Deepgram stream failed', { cause: error }));
    }
  });

  return {
    send(frame) {
      if (ending || done) return;
      socket.send(frame);
      lastSentAt = Date.now();
    },
    get bufferedBytes() {
      return socket.bufferedAmount;
    },
    async finish() {
      if (ending || done) return;
      ending = true;
      // Flush pending audio into final results, then end the stream; Deepgram closes afterwards.
      socket.send(JSON.stringify({ type: 'Finalize' }));
      socket.send(JSON.stringify({ type: 'CloseStream' }));
      await closed(socket, 5_000);
    },
    abort() {
      ending = true;
      aborted = true;
      stopKeepAlive();
      socket.terminate();
    },
  };
}
