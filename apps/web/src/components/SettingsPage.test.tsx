import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettings } from '../state/settings';

import { SettingsPage } from './SettingsPage';

const TOKEN = 't'.repeat(48);
const status = {
  schemaVersion: 1,
  privacyMode: 'local',
  providers: [
    {
      service: 'fact-checker',
      role: 'llm',
      provider: 'openai-compatible',
      model: 'qwen3',
      cloud: false,
    },
    { service: 'fact-checker', role: 'classifier', provider: 'typesafe', cloud: true },
  ],
};

describe('SettingsPage (brief 11, 15.6)', () => {
  beforeEach(() => {
    useSettings.setState({ token: null });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('saves a token, shows the providers and the Jev notice, and removes the token again', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      requests.push(init);
      return Promise.resolve(new Response(JSON.stringify(status), { status: 200 }));
    });
    render(<SettingsPage gatewayUrl="/api" />);
    expect(
      screen.getByText('Bitte zuerst in den Einstellungen das Zugangstoken eintragen.'),
    ).toBeTruthy();

    // Blank input is ignored.
    fireEvent.submit(screen.getByTestId('token-save'));
    expect(useSettings.getState().token).toBeNull();

    fireEvent.change(screen.getByTestId('token-input'), { target: { value: ` ${TOKEN} ` } });
    fireEvent.submit(screen.getByTestId('token-save'));
    expect(useSettings.getState().token).toBe(TOKEN);
    expect(screen.getByRole('status').textContent).toBe('Gespeichert.');
    expect(screen.getByTestId<HTMLInputElement>('token-input').value).toBe('');

    expect((await screen.findByTestId('privacy-mode')).textContent).toContain('Lokaler Modus');
    const rows = screen.getAllByTestId('provider').map((row) => row.textContent);
    expect(rows[0]).toContain('Sprachmodell (fact-checker): openai-compatible · qwen3');
    expect(rows[0]).toContain('bleibt lokal');
    expect(rows[1]).toContain('Daten verlassen das eigene Netzwerk');
    expect(screen.getByTestId('jev-notice')).toBeTruthy();
    expect(requests[0]?.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });

    fireEvent.click(screen.getByTestId('token-clear'));
    expect(useSettings.getState().token).toBeNull();
    expect(screen.queryByTestId('token-clear')).toBeNull();
  });

  it('shows an error when the providers cannot be loaded', async () => {
    useSettings.setState({ token: TOKEN });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })));
    render(<SettingsPage gatewayUrl="/api" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Anbieter konnten nicht geladen werden.',
    );
  });

  it('shows cloud mode without a Jev notice', async () => {
    useSettings.setState({ token: TOKEN });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...status,
            privacyMode: 'cloud',
            providers: [
              { service: 'fact-checker', role: 'search', provider: 'mock', cloud: false },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SettingsPage gatewayUrl="/api" />);
    expect((await screen.findByTestId('privacy-mode')).textContent).toBe(
      'Cloud-Anbieter sind erlaubt.',
    );
    expect(screen.queryByTestId('jev-notice')).toBeNull();
  });
});
