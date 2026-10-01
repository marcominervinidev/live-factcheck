import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConsentDialog } from './ConsentDialog';

const noop = () => undefined;

const STATUS_BODY = JSON.stringify({
  schemaVersion: 2,
  privacyMode: 'cloud',
  providers: [
    { service: 'transcription', role: 'stt', provider: 'deepgram', model: 'nova-3', cloud: true },
  ],
});

describe('ConsentDialog retry (design T6.5)', () => {
  afterEach(() => {
    cleanup();
  });

  it('recovers from a failed provider load without closing the dialog', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(new Response(STATUS_BODY, { status: 200 }));
    }) as typeof fetch;
    render(
      <ConsentDialog
        gatewayUrl=""
        token="t"
        onAccept={noop}
        onCancel={noop}
        fetchImpl={fetchImpl}
      />,
    );

    const retry = await screen.findByTestId('consent-retry');
    expect(screen.getByTestId('consent-error')).toBeTruthy();
    expect(screen.getByTestId('consent-accept')).toHaveProperty('disabled', true);

    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('consent-error')).toBeNull();
    expect(screen.getAllByTestId('consent-provider')).toHaveLength(1);
    expect(screen.getByTestId('consent-accept')).toHaveProperty('disabled', false);
  });
});
