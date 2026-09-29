// Forwarding to `stt-local` (faster-whisper with VAD chunks, brief 10, ADR 0016). The protocol is
// ours and implemented by services/stt-local (plan TP3):
//   client → {"type":"start","sampleRate":16000,"language":"de"}, binary PCM16 frames, {"type":"stop"}
//   server → {"type":"segment","text","isFinal","startMs","endMs"} … ; {"type":"error","message"}
// After `stop` the server sends the remaining segments and closes the connection normally.
import type WebSocket from 'ws';
import { z } from 'zod';

import type { SttConfig } from './config.js';
import { closed, openSocket, parseJson } from './socket.js';
import type { SttHandlers, SttProvider, SttSession } from './types.js';
import { SttError } from './types.js';

export const LocalSttMessage = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('segment'),
    text: z.string().max(10_000),
    isFinal: z.boolean(),
    startMs: z.int().nonnegative(),
    endMs: z.int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('error'), message: z.string().max(300) }),
]);

/** Local transcription can take longer to finish the last chunk than a cloud provider. */
const FINISH_TIMEOUT_MS = 30_000;

export function createLocalSttProvider(config: SttConfig & { LOCAL_STT_URL: string }): SttProvider {
  return {
    name: 'local',
    model: config.STT_MODEL,
    async open(options, handlers) {
      const socket = await openSocket(config.LOCAL_STT_URL, {}, config.STT_CONNECT_TIMEOUT_MS);
      socket.send(
        JSON.stringify({
          type: 'start',
          sampleRate: options.sampleRate,
          language: options.language,
        }),
      );
      return localSession(socket, handlers);
    },
  };
}

function localSession(socket: WebSocket, handlers: SttHandlers): SttSession {
  let ending = false;
  let aborted = false;
  let done = false;
  const fail = (error: SttError) => {
    if (done) return;
    done = true;
    handlers.onError(error);
    socket.terminate();
  };

  socket.on('message', (data, isBinary) => {
    if (aborted) return;
    const message = LocalSttMessage.safeParse(parseJson(data, isBinary));
    if (!message.success) {
      fail(new SttError('protocol', 'stt-local sent an invalid message'));
      return;
    }
    if (message.data.type === 'error') {
      fail(new SttError('protocol', `stt-local: ${message.data.message}`));
      return;
    }
    const { text, isFinal, startMs, endMs } = message.data;
    if (text.trim() === '') return;
    handlers.onSegment({ text: text.trim(), isFinal, startMs, endMs, speaker: 'A' });
  });
  socket.on('close', () => {
    if (!ending) fail(new SttError('closed', 'stt-local closed the stream'));
    done = true;
  });
  socket.on('error', (error) => {
    fail(new SttError('closed', 'stt-local stream failed', { cause: error }));
  });

  return {
    send(frame) {
      if (ending || done) return;
      socket.send(frame);
    },
    get bufferedBytes() {
      return socket.bufferedAmount;
    },
    async finish() {
      if (ending || done) return;
      ending = true;
      socket.send(JSON.stringify({ type: 'stop' }));
      await closed(socket, FINISH_TIMEOUT_MS);
    },
    abort() {
      ending = true;
      aborted = true;
      socket.terminate();
    },
  };
}
