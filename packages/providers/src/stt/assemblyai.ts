// AssemblyAI Universal-Streaming (v3) over the documented WebSocket protocol with `ws` (ADR 0016,
// `.ai/research/stt-providers.md`). Tested against a fake server only; no diarization without the
// pro model, so every segment gets speaker `A`.
import type WebSocket from 'ws';
import { z } from 'zod';

import type { SttConfig } from './config.js';
import { closed, keepAlive, openSocket, parseJson } from './socket.js';
import type { SttHandlers, SttOpenOptions, SttProvider, SttSession } from './types.js';
import { SttError } from './types.js';

export const ASSEMBLYAI_HOSTS = {
  eu: 'wss://streaming.eu.assemblyai.com',
  us: 'wss://streaming.assemblyai.com',
} as const;

const Turn = z.object({
  type: z.literal('Turn'),
  transcript: z.string(),
  end_of_turn: z.boolean(),
  turn_is_formatted: z.boolean().default(false),
  words: z
    .array(z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() }))
    .default([]),
});

export function streamingUrl(config: SttConfig, options: SttOpenOptions, host: string): string {
  const params = new URLSearchParams({
    sample_rate: String(options.sampleRate),
    encoding: 'pcm_s16le',
    speech_model: config.STT_MODEL,
    format_turns: 'true',
  });
  return `${host}/v3/ws?${params.toString()}`;
}

export function createAssemblyAiProvider(
  config: SttConfig & { ASSEMBLYAI_API_KEY: string },
  host: string = ASSEMBLYAI_HOSTS[config.STT_REGION],
): SttProvider {
  return {
    name: 'assemblyai',
    model: config.STT_MODEL,
    async open(options, handlers) {
      const socket = await openSocket(
        streamingUrl(config, options, host),
        { authorization: config.ASSEMBLYAI_API_KEY },
        config.STT_CONNECT_TIMEOUT_MS,
      );
      return assemblyAiSession(socket, handlers);
    },
  };
}

function assemblyAiSession(socket: WebSocket, handlers: SttHandlers): SttSession {
  let lastSentAt = Date.now();
  let ending = false;
  let aborted = false;
  let done = false;

  socket.on('message', (data, isBinary) => {
    if (aborted) return;
    const turn = Turn.safeParse(parseJson(data, isBinary));
    if (!turn.success) return;
    const { transcript, end_of_turn: endOfTurn, turn_is_formatted: formatted, words } = turn.data;
    const text = transcript.trim();
    // With format_turns a finished turn arrives twice; only the formatted one counts.
    if (text === '' || (endOfTurn && !formatted)) return;
    handlers.onSegment({
      text,
      isFinal: endOfTurn,
      startMs: Math.round(words[0]?.start ?? 0),
      endMs: Math.round(words.at(-1)?.end ?? 0),
      speaker: 'A',
    });
  });

  const stopKeepAlive = keepAlive(socket, JSON.stringify({ type: 'KeepAlive' }), () => lastSentAt);

  socket.on('close', () => {
    stopKeepAlive();
    if (!ending && !done) handlers.onError(new SttError('closed', 'AssemblyAI closed the stream'));
    done = true;
  });
  socket.on('error', (error) => {
    if (!done) {
      done = true;
      handlers.onError(new SttError('closed', 'AssemblyAI stream failed', { cause: error }));
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
      socket.send(JSON.stringify({ type: 'Terminate' }));
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
