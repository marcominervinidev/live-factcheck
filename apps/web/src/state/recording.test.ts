import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Microphone } from '../audio/microphone';
import { STOP_TIMEOUT_MS, useRecording } from './recording';

const RECORDING_ID = '7d2f7a0e-0f3c-4d8a-9b61-5f0e2a4c9b11';

/** A fake microphone at the system boundary; `emit` plays one frame. */
function fakeMicrophone(failWith?: Error) {
  let onFrame: ((frame: ArrayBuffer) => void) | undefined;
  let release: (() => void) | undefined;
  const mic = {
    stopped: 0,
    /** Resolves `start` later, like an open permission prompt. */
    hold: false,
    start: vi.fn((callback: (frame: ArrayBuffer) => void) => {
      onFrame = callback;
      if (failWith !== undefined) return Promise.reject(failWith);
      if (!mic.hold) return Promise.resolve();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    }),
    stop: vi.fn(() => {
      mic.stopped += 1;
    }),
    emit: (bytes = 3_200) => onFrame?.(new ArrayBuffer(bytes)),
    grant: () => release?.(),
  };
  return mic satisfies Microphone;
}

function fakeSender(open = true) {
  const sent: (string | ArrayBuffer)[] = [];
  const send = vi.fn((data: string | ArrayBuffer) => {
    if (!open) return false;
    sent.push(data);
    return true;
  });
  const controls = () =>
    sent.flatMap((d) => (typeof d === 'string' ? [(JSON.parse(d) as { type: string }).type] : []));
  const frames = () => sent.filter((d) => d instanceof ArrayBuffer).length;
  return { send, controls, frames };
}

const started = { type: 'audio.started', schemaVersion: 2, recordingId: RECORDING_ID } as const;
const stopped = (reason: 'client' | 'budget_exceeded' | 'overloaded') =>
  ({ type: 'audio.stopped', schemaVersion: 2, recordingId: RECORDING_ID, reason }) as const;

describe('recording store (ADR 0015)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    useRecording.getState().connectionLost();
    useRecording.setState({ lastEnd: null });
    vi.useRealTimers();
  });

  it('asks for the microphone, sends audio.start and sends frames only after audio.started', async () => {
    const mic = fakeMicrophone();
    const sender = fakeSender();
    await useRecording.getState().start(mic, sender.send);
    expect(useRecording.getState().status).toBe('starting');
    expect(sender.controls()).toEqual(['audio.start']);
    const start = sender.send.mock.calls[0]?.[0];
    expect(typeof start === 'string' ? JSON.parse(start) : start).toMatchObject({
      sampleRate: 16_000,
      encoding: 'pcm16',
      channels: 1,
      language: 'de',
    });

    mic.emit();
    expect(sender.frames()).toBe(0);

    useRecording.getState().handleServerMessage(started);
    expect(useRecording.getState()).toMatchObject({
      status: 'recording',
      recordingId: RECORDING_ID,
    });
    mic.emit();
    mic.emit();
    expect(sender.frames()).toBe(2);
  });

  it('stops: releases the microphone at once, sends audio.stop and ends on audio.stopped', async () => {
    const mic = fakeMicrophone();
    const sender = fakeSender();
    await useRecording.getState().start(mic, sender.send);
    useRecording.getState().handleServerMessage(started);

    useRecording.getState().stop();
    expect(mic.stop).toHaveBeenCalled();
    expect(useRecording.getState().status).toBe('stopping');
    mic.emit();
    expect(sender.frames()).toBe(0);
    expect(sender.controls()).toEqual(['audio.start', 'audio.stop']);

    useRecording.getState().handleServerMessage(stopped('client'));
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'client' });
  });

  it('shows the server reason when the server ends the recording (e.g. budget)', async () => {
    const mic = fakeMicrophone();
    await useRecording.getState().start(mic, fakeSender().send);
    useRecording.getState().handleServerMessage(started);
    useRecording.getState().handleServerMessage(stopped('budget_exceeded'));
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'budget_exceeded' });
    expect(mic.stopped).toBeGreaterThan(0);
  });

  it('keeps "background" as the reason when the app went to the background', async () => {
    await useRecording.getState().start(fakeMicrophone(), fakeSender().send);
    useRecording.getState().handleServerMessage(started);
    useRecording.getState().stop('background');
    useRecording.getState().handleServerMessage(stopped('client'));
    expect(useRecording.getState().lastEnd).toBe('background');
  });

  it('ends without audio.stopped after the stop timeout', async () => {
    await useRecording.getState().start(fakeMicrophone(), fakeSender().send);
    useRecording.getState().handleServerMessage(started);
    useRecording.getState().stop();
    vi.advanceTimersByTime(STOP_TIMEOUT_MS);
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'client' });
  });

  it('reports a refused microphone and sends nothing', async () => {
    const sender = fakeSender();
    await useRecording
      .getState()
      .start(fakeMicrophone(new DOMException('denied', 'NotAllowedError')), sender.send);
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'microphone_denied' });
    expect(sender.send).not.toHaveBeenCalled();

    await useRecording.getState().start(fakeMicrophone(new Error('no device')), sender.send);
    expect(useRecording.getState().lastEnd).toBe('microphone_error');
  });

  it('cancels at the permission prompt without telling the server', async () => {
    const mic = fakeMicrophone();
    mic.hold = true;
    const sender = fakeSender();
    const starting = useRecording.getState().start(mic, sender.send);
    useRecording.getState().stop();
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'client' });
    mic.grant();
    await starting;
    expect(sender.send).not.toHaveBeenCalled();
    expect(useRecording.getState().status).toBe('idle');
  });

  it('ends the recording when the connection is lost or the socket is not open', async () => {
    const mic = fakeMicrophone();
    await useRecording.getState().start(mic, fakeSender().send);
    useRecording.getState().handleServerMessage(started);
    useRecording.getState().connectionLost();
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'connection_lost' });
    expect(mic.stopped).toBeGreaterThan(0);

    await useRecording.getState().start(fakeMicrophone(), fakeSender(false).send);
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'connection_lost' });
  });

  it('gives up when the server rejects the start', async () => {
    await useRecording.getState().start(fakeMicrophone(), fakeSender().send);
    useRecording.getState().handleServerMessage({
      type: 'error',
      schemaVersion: 2,
      code: 'audio_already_started',
      message: 'A recording is already running',
    });
    expect(useRecording.getState()).toMatchObject({ status: 'idle', lastEnd: 'rejected' });
  });

  it('ignores a second start while one is running', async () => {
    const first = fakeMicrophone();
    const second = fakeMicrophone();
    await useRecording.getState().start(first, fakeSender().send);
    await useRecording.getState().start(second, fakeSender().send);
    expect(second.start).not.toHaveBeenCalled();
  });
});
describe('lastEndRecorded and clearEnd (T6.5 PR 4)', () => {
  it('marks only ends of recordings that really started, clearEnd resets both', async () => {
    const send = () => true;
    await useRecording.getState().start(fakeMicrophone(), send);
    // Stop before audio.started ever arrived: never a real recording.
    useRecording.getState().stop();
    useRecording.getState().handleServerMessage({
      type: 'audio.stopped',
      schemaVersion: 2,
      recordingId: '7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918',
      reason: 'client',
    });
    expect(useRecording.getState().lastEnd).toBe('client');
    expect(useRecording.getState().lastEndRecorded).toBe(false);

    await useRecording.getState().start(fakeMicrophone(), send);
    useRecording.getState().handleServerMessage({
      type: 'audio.started',
      schemaVersion: 2,
      recordingId: '7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918',
    });
    useRecording.getState().stop();
    useRecording.getState().handleServerMessage({
      type: 'audio.stopped',
      schemaVersion: 2,
      recordingId: '7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918',
      reason: 'client',
    });
    expect(useRecording.getState().lastEndRecorded).toBe(true);

    useRecording.getState().clearEnd();
    expect(useRecording.getState().lastEnd).toBeNull();
    expect(useRecording.getState().lastEndRecorded).toBe(false);
  });
});
