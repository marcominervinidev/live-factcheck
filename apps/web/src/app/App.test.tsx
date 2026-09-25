import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { useRuntimeConfig } from './runtime-config';

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
      'Noch keine Behauptungen geprüft.',
    );
  });

  it('shows an alert when the config cannot be loaded', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('not found', { status: 404 })));
    render(<App />);

    expect((await screen.findByRole('alert')).dataset['testid']).toBe('config-error');
  });
});
