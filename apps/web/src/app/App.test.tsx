import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClaims } from '../state/claims';
import { useRecording } from '../state/recording';
import { CLAIM_ID, checked, detected } from '../testing/fixtures';

import { App } from './App';
import { useRuntimeConfig } from './runtime-config';

const OTHER_ID = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

describe('App shell', () => {
  beforeEach(() => {
    useRuntimeConfig.setState({ state: { status: 'idle' } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the German title and the empty feed once the config is loaded', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ gatewayUrl: '/api' }), { status: 200 })),
    );
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Live-Faktencheck');
    expect((await screen.findByTestId('claims-empty')).textContent).toBe(
      'Noch keine Behauptungen geprüft. Tippe eine Behauptung ein, um zu starten.',
    );
  });

  it('shows an alert when the config cannot be loaded', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('not found', { status: 404 })));
    render(<App />);

    expect((await screen.findByRole('alert')).dataset['testid']).toBe('config-error');
  });

  it('leads from the missing-token hint to the settings page', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ gatewayUrl: '/api' }), { status: 200 })),
    );
    render(<App />);
    fireEvent.click(await screen.findByTestId('no-token-settings'));
    expect(await screen.findByTestId('settings')).toBeTruthy();
  });
});

/** The Danach trigger wired into CheckView (T6.5 PR 4; late verdicts via the third review). */
describe('App Danach trigger', () => {
  const detectedEvent = (overrides: Parameters<typeof detected>[0] = {}) =>
    ({ type: 'claim.detected', schemaVersion: 2, payload: detected(overrides) }) as const;
  const checkedEvent = (overrides: Parameters<typeof checked>[0] = {}) =>
    ({ type: 'claim.checked', schemaVersion: 2, payload: checked(overrides) }) as const;

  const renderReadyApp = async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ gatewayUrl: '/api' }), { status: 200 })),
    );
    render(<App />);
    await screen.findByTestId('claims-empty');
  };

  beforeEach(() => {
    useRuntimeConfig.setState({ state: { status: 'idle' } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    act(() => {
      useClaims.getState().reset();
      useRecording.setState({
        status: 'idle',
        recordingId: null,
        lastEnd: null,
        lastEndRecorded: false,
        lastEndSummaryShown: false,
      });
    });
  });

  it('opens the summary once a late verdict lands, and a closed summary stays closed', async () => {
    await renderReadyApp();
    act(() => {
      useClaims.getState().applyEvent(detectedEvent());
      useRecording.setState({ lastEnd: 'client', lastEndRecorded: true });
    });
    // The talk ended, but nothing has a verdict yet: nothing to summarise.
    expect(screen.queryByTestId('summary-view')).toBeNull();

    act(() => {
      useClaims.getState().applyEvent(checkedEvent());
    });
    expect(await screen.findByTestId('summary-view')).toBeTruthy();

    fireEvent.click(screen.getByTestId('summary-close'));
    expect(screen.queryByTestId('summary-view')).toBeNull();
    // A further late verdict must not reopen what the user closed.
    act(() => {
      useClaims.getState().applyEvent(detectedEvent({ claimId: OTHER_ID }));
      useClaims.getState().applyEvent(checkedEvent({ claimId: OTHER_ID }));
    });
    expect(screen.queryByTestId('summary-view')).toBeNull();
  });

  it('never opens for a server end, even with checked claims', async () => {
    await renderReadyApp();
    act(() => {
      useClaims.getState().applyEvent(detectedEvent());
      useClaims.getState().applyEvent(checkedEvent());
      useRecording.setState({ lastEnd: 'budget_exceeded', lastEndRecorded: true });
    });
    expect(screen.queryByTestId('summary-view')).toBeNull();
  });

  it('walks summary → Zeigen → summary, and "Neues Gespräch" clears the talk', async () => {
    await renderReadyApp();
    act(() => {
      useClaims.getState().applyEvent(detectedEvent());
      useClaims.getState().applyEvent(checkedEvent());
      useRecording.setState({ lastEnd: 'client', lastEndRecorded: true });
    });
    fireEvent.click(await screen.findByTestId('summary-item'));
    expect(await screen.findByTestId('show-view')).toBeTruthy();
    fireEvent.click(screen.getByTestId('show-back'));
    // Back from Zeigen: the summary returns and the focus lands on the claim's row.
    expect(await screen.findByTestId('summary-view')).toBeTruthy();
    expect(document.activeElement?.getAttribute('data-claim-id')).toBe(CLAIM_ID);

    fireEvent.click(screen.getByTestId('summary-new'));
    expect(screen.queryByTestId('summary-view')).toBeNull();
    expect(screen.getByTestId('claims-empty')).toBeTruthy();
    expect(useRecording.getState().lastEnd).toBeNull();
  });
});
