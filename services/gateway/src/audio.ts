import { randomUUID } from 'node:crypto';

import type { AudioStopReason, WsAudioStart, WsErrorCode, WsServerMessage } from '@lfc/contracts';
import {
  AUDIO_FRAME_MAX_BYTES,
  AUDIO_FRAMES_PER_SECOND_MAX,
  TranscriptionServerMessage,
} from '@lfc/contracts';
import type { Logger } from '@lfc/service-kit';
import WebSocket from 'ws';

export interface AudioOptions {
  /** Internal WebSocket of `transcription`, e.g. `ws://transcription:8080/v1/audio`. */
  readonly transcriptionUrl: string;
  readonly maxRecordingMs: number;
  /** How long `transcription` may take to answer `start` with `ready` (and `stop` with `stopped`). */
  readonly answerTimeoutMs: number;
  /** Audio waiting for the internal socket beyond which the recording stops (ADR 0015: ≈ 2 s). */
  readonly maxBufferedBytes: number;
  /** The frame rate limit is averaged over this window. */
  readonly rateWindowMs: number;
}

export const DEFAULT_AUDIO_OPTIONS = {
  answerTimeoutMs: 10_000,
  maxBufferedBytes: 64 * 1024,
  rateWindowMs: 5_000,
} as const;

/** The gateway's side of one session's recordings (ADR 0015). */
export interface AudioChannel {
  start(message: WsAudioStart): void;
  frame(data: Buffer): void;
  stop(): void;
  /** The client socket closed: end everything without further messages. */
  close(): void;
}

type Phase = 'idle' | 'starting' | 'recording' | 'stopping';

function textOf(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

const ERROR_TEXT: Readonly<Partial<Record<WsErrorCode, string>>> = {
  audio_not_started: 'Send audio.start and wait for audio.started before audio frames',
  audio_already_started: 'A recording is already running',
  frame_too_large: 'Audio frame too large (at most 8 KiB)',
  frame_rate_exceeded: 'Too many audio frames; the recording was stopped',
};

/**
 * Forwards one recording at a time to `transcription` over an internal WebSocket. The gateway
 * never buffers audio: a slow internal socket stops the recording with `overloaded`. Errors of a
 * recording end only the recording, never the session (text mode keeps working).
 */
export function audioChannel(
  sessionId: string,
  send: (message: WsServerMessage) => void,
  options: AudioOptions,
  logger: Logger,
): AudioChannel {
  let phase: Phase = 'idle';
  let recordingId = '';
  let internal: WebSocket | undefined;
  let answerTimer: NodeJS.Timeout | undefined;
  let limitTimer: NodeJS.Timeout | undefined;
  let frames: number[] = [];
  const maxFramesInWindow = (AUDIO_FRAMES_PER_SECOND_MAX * options.rateWindowMs) / 1_000;

  const error = (code: WsErrorCode) => {
    send({ type: 'error', schemaVersion: 2, code, message: ERROR_TEXT[code] ?? code });
  };

  const reset = () => {
    clearTimeout(answerTimer);
    clearTimeout(limitTimer);
    const socket = internal;
    internal = undefined;
    frames = [];
    phase = 'idle';
    if (socket !== undefined) {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.terminate();
    }
  };

  /** Ends the current recording and tells the client why. */
  const finish = (reason: AudioStopReason) => {
    if (phase === 'idle') return;
    const id = recordingId;
    reset();
    send({ type: 'audio.stopped', schemaVersion: 2, recordingId: id, reason });
    logger.info({ sessionId, recordingId: id, reason }, 'recording stopped');
  };

  const onInternalMessage = (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) return;
    let parsed: ReturnType<typeof TranscriptionServerMessage.safeParse> | undefined;
    try {
      parsed = TranscriptionServerMessage.safeParse(JSON.parse(textOf(data)));
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success || parsed.data.recordingId !== recordingId) {
      logger.warn({ sessionId, recordingId }, 'transcription sent an invalid message');
      finish('provider_error');
      return;
    }
    if (parsed.data.type === 'stopped') {
      finish(parsed.data.reason);
      return;
    }
    if (phase !== 'starting') return;
    clearTimeout(answerTimer);
    phase = 'recording';
    limitTimer = setTimeout(() => {
      finish('recording_limit');
    }, options.maxRecordingMs);
    send({ type: 'audio.started', schemaVersion: 2, recordingId });
    logger.info({ sessionId, recordingId }, 'recording started');
  };

  return {
    start(message) {
      if (phase !== 'idle') {
        error('audio_already_started');
        return;
      }
      phase = 'starting';
      recordingId = randomUUID();
      const socket = new WebSocket(options.transcriptionUrl, {
        handshakeTimeout: options.answerTimeoutMs,
      });
      internal = socket;
      answerTimer = setTimeout(() => {
        logger.warn({ sessionId, recordingId }, 'transcription did not answer in time');
        finish('provider_error');
      }, options.answerTimeoutMs);
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            type: 'start',
            schemaVersion: 1,
            sessionId,
            recordingId,
            sampleRate: message.sampleRate,
            encoding: message.encoding,
            channels: message.channels,
            language: message.language,
          }),
        );
      });
      socket.on('message', onInternalMessage);
      socket.on('close', () => {
        finish('provider_error');
      });
      socket.on('error', (cause) => {
        logger.warn({ sessionId, recordingId, err: cause }, 'transcription connection failed');
        finish('provider_error');
      });
    },

    frame(data) {
      if (phase !== 'recording' || internal === undefined) {
        error('audio_not_started');
        return;
      }
      if (data.byteLength > AUDIO_FRAME_MAX_BYTES) {
        // A single oversized frame is dropped; the recording goes on.
        error('frame_too_large');
        return;
      }
      const now = Date.now();
      frames = frames.filter((t) => now - t < options.rateWindowMs);
      frames.push(now);
      if (frames.length > maxFramesInWindow) {
        // Faster than real time: not a microphone. Stop before it costs STT money.
        error('frame_rate_exceeded');
        finish('overloaded');
        return;
      }
      if (internal.bufferedAmount > options.maxBufferedBytes) {
        finish('overloaded');
        return;
      }
      internal.send(data);
    },

    stop() {
      if (phase === 'idle') {
        error('audio_not_started');
        return;
      }
      if (phase === 'starting' || internal === undefined) {
        finish('client');
        return;
      }
      if (phase === 'stopping') return;
      phase = 'stopping';
      clearTimeout(limitTimer);
      internal.send(JSON.stringify({ type: 'stop', schemaVersion: 1 }));
      // transcription answers with `stopped` once the provider delivered the last words.
      answerTimer = setTimeout(() => {
        finish('client');
      }, options.answerTimeoutMs * 4);
    },

    close() {
      if (phase !== 'idle')
        logger.info({ sessionId, recordingId }, 'recording ended with the session');
      reset();
    },
  };
}
