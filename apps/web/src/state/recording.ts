import type { AudioStopReason, WsServerMessage } from '@lfc/contracts';
import { AUDIO_SAMPLE_RATE } from '@lfc/contracts';
import { create } from 'zustand';

import type { Microphone } from '../audio/microphone';

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping';

/** Why the last recording ended: the server's reasons plus what only the browser sees. */
export type RecordingEnd =
  | AudioStopReason
  | 'connection_lost'
  | 'background'
  | 'microphone_denied'
  | 'microphone_error'
  | 'rejected';

/** Sends on the session socket; false when it is not open. */
export type SessionSender = (data: string | ArrayBuffer) => boolean;

/** Without `audio.stopped` after this long, the recording counts as ended anyway. */
export const STOP_TIMEOUT_MS = 10_000;

interface RecordingStore {
  status: RecordingStatus;
  recordingId: string | null;
  lastEnd: RecordingEnd | null;
  /** True when the ended attempt had really started recording (`audio.started` arrived). */
  lastEndRecorded: boolean;
  start: (microphone: Microphone, send: SessionSender) => Promise<void>;
  /** Ends the recording on the user's request or because the app went to the background. */
  stop: (why?: 'client' | 'background') => void;
  handleServerMessage: (message: WsServerMessage) => void;
  /** The session socket closed: a recording cannot survive it (a new session gets a new id). */
  connectionLost: () => void;
  /** "Neues Gespräch": the shown end is acknowledged, the next start begins clean. */
  clearEnd: () => void;
}

let microphone: Microphone | undefined;
let sender: SessionSender | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
/** The browser-side reason wins over the server's `client` (e.g. `background`). */
let requestedEnd: RecordingEnd | undefined;
/** audio.start went out, so the server will answer audio.stopped. */
let startSent = false;

/**
 * One recording at a time over the session WebSocket (brief 6.2, ADR 0015): the microphone is
 * released as soon as the recording ends for whatever reason, and frames are sent only between
 * `audio.started` and the stop, so nothing reaches the server before it is ready.
 */
export const useRecording = create<RecordingStore>((set, get) => {
  const finish = (end: RecordingEnd) => {
    clearTimeout(stopTimer);
    microphone?.stop();
    microphone = undefined;
    sender = undefined;
    startSent = false;
    const lastEnd = requestedEnd ?? end;
    requestedEnd = undefined;
    // The store knows whether audio.started ever came - the UI must not reconstruct it.
    set({
      status: 'idle',
      recordingId: null,
      lastEnd,
      lastEndRecorded: get().recordingId !== null,
    });
  };

  return {
    status: 'idle',
    recordingId: null,
    lastEnd: null,
    lastEndRecorded: false,
    start: async (mic, send) => {
      if (get().status !== 'idle') return;
      microphone = mic;
      sender = send;
      requestedEnd = undefined;
      set({ status: 'starting', lastEnd: null });
      try {
        await mic.start((frame) => {
          if (get().status === 'recording') sender?.(frame);
        });
      } catch (error) {
        if (microphone === mic)
          finish(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'microphone_denied'
              : 'microphone_error',
          );
        return;
      }
      // Stopped while the permission prompt was open.
      if (microphone !== mic || get().status !== 'starting') return;
      const sent = send(
        JSON.stringify({
          type: 'audio.start',
          schemaVersion: 2,
          sampleRate: AUDIO_SAMPLE_RATE,
          encoding: 'pcm16',
          channels: 1,
          // LANG-EN: conversations are German only; send the chosen conversation language here (ADR 0020)
          language: 'de',
        }),
      );
      if (sent) startSent = true;
      else finish('connection_lost');
    },
    stop: (why = 'client') => {
      const { status } = get();
      if (status === 'idle' || status === 'stopping') return;
      requestedEnd = why === 'client' ? undefined : why;
      if (!startSent) {
        // Still at the permission prompt: the server knows nothing of this recording yet.
        finish('client');
        return;
      }
      // No more frames from here on; the server still delivers the last words.
      microphone?.stop();
      set({ status: 'stopping' });
      if (sender?.(JSON.stringify({ type: 'audio.stop', schemaVersion: 2 })) !== true) {
        finish('client');
        return;
      }
      stopTimer = setTimeout(() => {
        finish('client');
      }, STOP_TIMEOUT_MS);
    },
    handleServerMessage: (message) => {
      if (get().status === 'idle') return;
      if (message.type === 'audio.started') {
        if (get().status === 'starting')
          set({ status: 'recording', recordingId: message.recordingId });
      } else if (message.type === 'audio.stopped') {
        finish(message.reason);
      } else if (
        message.type === 'error' &&
        (message.code === 'audio_already_started' || message.code === 'audio_not_started')
      ) {
        finish('rejected');
      }
    },
    clearEnd: () => {
      set({ lastEnd: null, lastEndRecorded: false });
    },
    connectionLost: () => {
      if (get().status !== 'idle') finish('connection_lost');
    },
  };
});
