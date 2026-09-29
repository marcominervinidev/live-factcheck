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

const Word = z.object({
  word: z.string(),
  /** With `punctuate`/`smart_format`: the word with punctuation and capitalisation. */
  punctuated_word: z.string().optional(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  speaker: z.number().int().nonnegative().optional(),
});

const Results = z.object({
  type: z.literal('Results'),
  is_final: z.boolean(),
  speech_final: z.boolean(),
  /** The answer to our `Finalize`: the speaker paused, so the unfinished rest is final too. */
  from_finalize: z.boolean().default(false),
  start: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  channel: z.object({
    alternatives: z
      .array(z.object({ transcript: z.string(), words: z.array(Word).default([]) }))
      .min(1),
  }),
});

const UtteranceEnd = z.object({ type: z.literal('UtteranceEnd') });

/** A word that ends a sentence (German punctuation from `punctuate`). */
const SENTENCE_END = /[.!?…]["»“”')]*$/;
/**
 * German ordinals like `2.` or `8.` ("der 2. Weltkrieg", "am 8. Mai" after `smart_format`) do not
 * end a sentence. Four-digit numbers (years like "1965.") do. Heuristic: a sentence that really
 * ends with a number below 1000 stays open until the next sentence end or pause.
 */
const ORDINAL = /^\d{1,3}\.$/;

const endsSentence = (word: string) => SENTENCE_END.test(word) && !ORDINAL.test(word);

/**
 * Own silence detection (T2.5): Deepgram finalized 13.6 s of speech with two speakers in one
 * block although the audio had 1 s pauses. After this much quiet audio following speech, the
 * adapter sends `Finalize`, so the words so far become final at once.
 */
export const FINALIZE_AFTER_SILENCE_MS = 500;
/** RMS of a 16-bit frame below which it counts as silence (about −40 dBFS). */
export const SILENCE_RMS = 330;

interface TimedWord {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker: number | undefined;
}

/** Root mean square of PCM16 LE samples. */
export function rms(frame: Uint8Array): number {
  const samples = Math.floor(frame.byteLength / 2);
  if (samples === 0) return 0;
  const view = new DataView(frame.buffer, frame.byteOffset, samples * 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const sample = view.getInt16(i * 2, true);
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
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
  // Finalized words not yet delivered as a final segment (the tail of an unfinished sentence).
  let pending: TimedWord[] = [];
  let lastSentAt = Date.now();
  let silentMs = 0;
  let speechSinceFinalize = false;
  let ending = false;
  let aborted = false;
  let done = false;

  const emit = (words: readonly TimedWord[]) => {
    const first = words[0];
    const last = words.at(-1);
    if (first === undefined || last === undefined) return;
    handlers.onSegment({
      text: words.map((w) => w.text).join(' '),
      isFinal: true,
      startMs: first.startMs,
      endMs: last.endMs,
      speaker: label(majority(words.map((w) => w.speaker))),
    });
  };

  /** Delivers every complete sentence in `pending`; with `all`, the unfinished rest as well. */
  const flush = (all: boolean) => {
    let from = 0;
    pending.forEach((word, index) => {
      if (endsSentence(word.text)) {
        emit(pending.slice(from, index + 1));
        from = index + 1;
      }
    });
    pending = pending.slice(from);
    if (all) {
      emit(pending);
      pending = [];
    }
  };

  socket.on('message', (data, isBinary) => {
    if (aborted) return;
    const json = parseJson(data, isBinary);
    const results = Results.safeParse(json);
    if (results.success) {
      const alternative = results.data.channel.alternatives[0];
      const transcript = alternative?.transcript.trim() ?? '';
      if (transcript === '' && !results.data.speech_final) return;
      const startMs = Math.round(results.data.start * 1_000);
      const endMs = Math.round((results.data.start + results.data.duration) * 1_000);
      const words: TimedWord[] =
        alternative === undefined || alternative.words.length === 0
          ? transcript === ''
            ? []
            : [{ text: transcript, startMs, endMs, speaker: undefined }]
          : alternative.words.map((w) => ({
              text: w.punctuated_word ?? w.word,
              startMs: Math.round(w.start * 1_000),
              endMs: Math.round(w.end * 1_000),
              speaker: w.speaker,
            }));
      if (results.data.is_final) {
        pending.push(...words);
        // Every finished sentence is a segment of its own, with its own speaker.
        flush(results.data.speech_final || results.data.from_finalize);
      } else if (words.length > 0) {
        const all = [...pending, ...words];
        handlers.onSegment({
          text: all.map((w) => w.text).join(' '),
          isFinal: false,
          startMs: all[0]?.startMs ?? startMs,
          endMs,
          speaker: label(majority(all.map((w) => w.speaker))),
        });
      }
      return;
    }
    if (UtteranceEnd.safeParse(json).success) flush(true);
  });

  const stopKeepAlive = keepAlive(socket, JSON.stringify({ type: 'KeepAlive' }), () => lastSentAt);

  socket.on('close', () => {
    stopKeepAlive();
    // After abort nothing is delivered any more; after finish the last words still count.
    if (!aborted) flush(true);
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
      if (rms(frame) < SILENCE_RMS) {
        silentMs += (frame.byteLength / 32_000) * 1_000;
        if (speechSinceFinalize && silentMs >= FINALIZE_AFTER_SILENCE_MS) {
          speechSinceFinalize = false;
          socket.send(JSON.stringify({ type: 'Finalize' }));
        }
      } else {
        silentMs = 0;
        speechSinceFinalize = true;
      }
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
