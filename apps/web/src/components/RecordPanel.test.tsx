import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Microphone } from '../audio/microphone';
import { useConnection } from '../state/connection';
import { useRecording } from '../state/recording';

import { RecordPanel } from './RecordPanel';

const TOKEN = 't'.repeat(48);
const RECORDING_ID = '7d2f7a0e-0f3c-4d8a-9b61-5f0e2a4c9b11';

const status = (providers: unknown[]) =>
  JSON.stringify({ schemaVersion: 2, privacyMode: 'cloud', providers });
const cloudStatus = status([
  { service: 'transcription', role: 'stt', provider: 'deepgram', model: 'nova-3', cloud: true },
  { service: 'claim-extractor', role: 'classifier', provider: 'typesafe', cloud: true },
  { service: 'fact-checker', role: 'llm', provider: 'openai-compatible', model: 'q', cloud: false },
]);

const respond = (body: string, code = 200) =>
  vi.fn((_input: URL | RequestInfo, _init?: RequestInit) =>
    Promise.resolve(new Response(body, { status: code })),
  );

/** A microphone that starts at once (system boundary). */
const microphone = (): Microphone => ({
  start: () => Promise.resolve(),
  stop: vi.fn(),
});

describe('RecordPanel (T6.1, T6.2)', () => {
  let sent: string[];

  beforeEach(() => {
    sent = [];
    useConnection.setState({
      status: 'open',
      send: (data) => {
        if (typeof data === 'string') sent.push(data);
        return true;
      },
    });
  });
  afterEach(() => {
    cleanup();
    useRecording.getState().connectionLost();
    useRecording.setState({ lastEnd: null });
    useConnection.setState({ status: 'idle' });
  });

  const openDialog = () => {
    fireEvent.click(screen.getByTestId('record-start'));
    return screen.getByTestId('consent-dialog');
  };

  it('asks for consent first and names every active cloud provider', async () => {
    const fetchImpl = respond(cloudStatus);
    const mic = microphone();
    render(
      <RecordPanel
        gatewayUrl="/api"
        token={TOKEN}
        fetchImpl={fetchImpl}
        createMicrophone={() => mic}
      />,
    );
    openDialog();
    expect(screen.getByTestId<HTMLButtonElement>('consent-accept').disabled).toBe(true);
    const providers = await screen.findAllByTestId('consent-provider');
    expect(providers.map((p) => p.textContent)).toEqual([
      'Spracherkennung: deepgram (nova-3)',
      'Klassifikator: typesafe',
    ]);
    expect(screen.getByText(/Jev \(TypeSafe\) läuft in den USA/)).toBeTruthy();
    expect(sent).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByTestId('consent-accept'));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('consent-dialog')).toBeNull();
    expect(sent.map((s) => (JSON.parse(s) as { type: string }).type)).toEqual(['audio.start']);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/status');
  });

  it('says so when everything is local', async () => {
    render(
      <RecordPanel
        gatewayUrl="/api"
        token={TOKEN}
        fetchImpl={respond(
          status([{ service: 'transcription', role: 'stt', provider: 'local', cloud: false }]),
        )}
        createMicrophone={microphone}
      />,
    );
    openDialog();
    expect((await screen.findByTestId('consent-local')).textContent).toContain('lokal');
  });

  it('allows no recording without the provider list (fails closed)', async () => {
    render(
      <RecordPanel
        gatewayUrl="/api"
        token={TOKEN}
        fetchImpl={respond('{}', 503)}
        createMicrophone={microphone}
      />,
    );
    openDialog();
    expect((await screen.findByTestId('consent-error')).textContent).toContain('keine Aufnahme');
    expect(screen.getByTestId<HTMLButtonElement>('consent-accept').disabled).toBe(true);
  });

  it('cancels without recording', async () => {
    render(
      <RecordPanel
        gatewayUrl="/api"
        token={TOKEN}
        fetchImpl={respond(cloudStatus)}
        createMicrophone={microphone}
      />,
    );
    openDialog();
    await screen.findAllByTestId('consent-provider');
    fireEvent.click(screen.getByTestId('consent-cancel'));
    expect(screen.queryByTestId('consent-dialog')).toBeNull();
    expect(useRecording.getState().status).toBe('idle');
    expect(sent).toEqual([]);
  });

  it('cannot start without a connection', () => {
    useConnection.setState({ status: 'reconnecting' });
    render(<RecordPanel gatewayUrl="/api" token={TOKEN} createMicrophone={microphone} />);
    expect(screen.getByTestId<HTMLButtonElement>('record-start').disabled).toBe(true);
    expect(screen.getByText('Aufnehmen ist möglich, sobald die Verbindung steht.')).toBeTruthy();
  });

  it('shows the running recording, stops it and explains why a recording ended', async () => {
    const mic = microphone();
    render(
      <RecordPanel
        gatewayUrl="/api"
        token={TOKEN}
        fetchImpl={respond(cloudStatus)}
        createMicrophone={() => mic}
      />,
    );
    openDialog();
    await screen.findAllByTestId('consent-provider');
    await act(async () => {
      fireEvent.click(screen.getByTestId('consent-accept'));
      await Promise.resolve();
    });
    act(() => {
      useRecording.getState().handleServerMessage({
        type: 'audio.started',
        schemaVersion: 2,
        recordingId: RECORDING_ID,
      });
    });
    expect(screen.getByTestId('recording-status').textContent).toContain('Aufnahme läuft');

    fireEvent.click(screen.getByTestId('record-stop'));
    expect(screen.getByTestId('recording-status').dataset['status']).toBe('stopping');
    act(() => {
      useRecording.getState().handleServerMessage({
        type: 'audio.stopped',
        schemaVersion: 2,
        recordingId: RECORDING_ID,
        reason: 'budget_exceeded',
      });
    });
    expect(screen.getByTestId('recording-end').textContent).toContain('Tagesbudget');
    expect(screen.getByTestId('record-start')).toBeTruthy();
  });

  it('ends the recording when the app goes to the background', async () => {
    const stop = vi.fn();
    const mic: Microphone = { start: () => Promise.resolve(), stop };
    render(<RecordPanel gatewayUrl="/api" token={TOKEN} createMicrophone={() => mic} />);
    await act(async () => {
      await useRecording.getState().start(mic, useConnection.getState().send);
    });
    act(() => {
      useRecording.getState().handleServerMessage({
        type: 'audio.started',
        schemaVersion: 2,
        recordingId: RECORDING_ID,
      });
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    expect(stop).toHaveBeenCalled();
    expect(sent.map((s) => (JSON.parse(s) as { type: string }).type)).toContain('audio.stop');
    act(() => {
      useRecording.getState().handleServerMessage({
        type: 'audio.stopped',
        schemaVersion: 2,
        recordingId: RECORDING_ID,
        reason: 'client',
      });
    });
    expect(screen.getByTestId('recording-end').dataset['reason']).toBe('background');
  });
});
describe('end reason cards (T6.5)', () => {
  const renderWithEnd = (end: 'microphone_denied' | 'background') => {
    useRecording.setState({ status: 'idle', lastEnd: end });
    render(
      <RecordPanel
        gatewayUrl=""
        token="t"
        createMicrophone={microphone}
        fetchImpl={respond(cloudStatus)}
      />,
    );
    return screen.getByTestId('recording-end');
  };

  it('paints a failure end red and a benign end lilac, each with an icon', () => {
    const failed = renderWithEnd('microphone_denied');
    expect(failed.className).toContain('bg-verdict-false-soft');
    expect(failed.querySelector('svg')).not.toBeNull();
    expect(failed.textContent).toContain('Mikrofon');
    cleanup();
    const benign = renderWithEnd('background');
    expect(benign.className).toContain('bg-lilac-soft');
    expect(benign.className).not.toContain('bg-verdict-false-soft');
    expect(benign.textContent).toContain('Hintergrund');
  });
});
