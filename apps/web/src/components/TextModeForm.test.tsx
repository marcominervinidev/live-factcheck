import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClaims } from '../state/claims';
import { useConnection } from '../state/connection';
import { useSettings } from '../state/settings';
import { CLAIM_ID, SESSION_ID } from '../testing/fixtures';

import { TextModeForm } from './TextModeForm';

const TOKEN = 't'.repeat(48);

const type = (text: string) => {
  fireEvent.change(screen.getByTestId('claim-input'), { target: { value: text } });
};
const button = () => screen.getByTestId<HTMLButtonElement>('claim-submit');

describe('TextModeForm (brief 6.8)', () => {
  beforeEach(() => {
    useSettings.setState({ token: TOKEN });
    useConnection.setState({ sessionId: SESSION_ID });
    useClaims.getState().reset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is disabled without text, token or session', () => {
    render(<TextModeForm gatewayUrl="/api" />);
    expect(button().disabled).toBe(true);
    type('Der Zweite Weltkrieg endete 1945.');
    expect(button().disabled).toBe(false);

    act(() => {
      useConnection.setState({ sessionId: null });
    });
    expect(button().disabled).toBe(true);
    // A submit that bypasses the button still sends nothing.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fireEvent.submit(screen.getByTestId('textmode-form'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps text typed while the previous claim was still being sent', async () => {
    let respond: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          respond = () => {
            resolve(
              new Response(
                JSON.stringify({ schemaVersion: 1, claimId: CLAIM_ID, sessionId: SESSION_ID }),
                { status: 202 },
              ),
            );
          };
        }),
    );
    render(<TextModeForm gatewayUrl="/api" />);
    type('Berlin hat 3,9 Millionen Einwohner.');
    fireEvent.submit(screen.getByTestId('textmode-form'));
    type('Ich finde, Berlin ist die schönste Stadt.');
    await act(async () => {
      respond?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(button().disabled).toBe(false);
    });
    expect(screen.getByTestId<HTMLTextAreaElement>('claim-input').value).toBe(
      'Ich finde, Berlin ist die schönste Stadt.',
    );
  });

  it('sends the trimmed claim, adds a pending card and clears the input', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return Promise.resolve(
        new Response(
          JSON.stringify({ schemaVersion: 1, claimId: CLAIM_ID, sessionId: SESSION_ID }),
          {
            status: 202,
          },
        ),
      );
    });
    render(<TextModeForm gatewayUrl="/api" />);
    type('  Der Zweite Weltkrieg endete 1945.  ');
    fireEvent.submit(screen.getByTestId('textmode-form'));

    await waitFor(() => {
      expect(useClaims.getState().order).toEqual([CLAIM_ID]);
    });
    expect(bodies[0]).toEqual({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      text: 'Der Zweite Weltkrieg endete 1945.',
    });
    expect(useClaims.getState().claims[CLAIM_ID]?.text).toBe('Der Zweite Weltkrieg endete 1945.');
    expect(screen.getByTestId<HTMLTextAreaElement>('claim-input').value).toBe('');
  });

  it.each([
    ['rate_limited', 'Zu viele Prüfungen in kurzer Zeit. Bitte kurz warten.'],
    ['unauthorized', 'Das Zugangstoken wurde abgelehnt.'],
    ['session_unknown', 'Die Verbindung wurde erneuert. Bitte erneut senden.'],
    ['budget_exceeded', 'Die Behauptung konnte nicht gesendet werden.'],
  ])('shows a German message for %s', async (code, message) => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ schemaVersion: 1, error: { code, message: 'x' } }), {
          status: 400,
        }),
      ),
    );
    render(<TextModeForm gatewayUrl="/api" />);
    type('Der Zweite Weltkrieg endete 1945.');
    fireEvent.submit(screen.getByTestId('textmode-form'));
    expect((await screen.findByTestId('claim-error')).textContent).toBe(message);
    // The text stays, so the user can send it again.
    expect(screen.getByTestId<HTMLTextAreaElement>('claim-input').value).toBe(
      'Der Zweite Weltkrieg endete 1945.',
    );
  });
});
