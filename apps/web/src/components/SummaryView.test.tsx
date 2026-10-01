import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLAIM_ID, checked, detected } from '../testing/fixtures';

import { SummaryView } from './SummaryView';

const OTHER_ID = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const noop = () => undefined;

const claims = () => [
  {
    claimId: CLAIM_ID,
    text: 'a',
    submittedAt: '2026-09-26T10:00:00.000Z',
    checked: checked(),
    explanationMissing: false,
  },
  // Still pending: never listed, the summary judges claims, not promises.
  {
    claimId: OTHER_ID,
    text: 'b',
    submittedAt: '2026-09-26T10:05:00.000Z',
    detected: detected(),
    explanationMissing: false,
  },
];

describe('SummaryView (T6.5, Danach)', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists only checked claims as colour bars and opens one on tap', () => {
    const onShow = vi.fn();
    render(<SummaryView claims={claims()} onShow={onShow} onNewTalk={noop} onClose={noop} />);
    expect(screen.getByTestId('summary-view').textContent).toContain('Ein Abend, eine Behauptung');
    const items = screen.getAllByTestId('summary-item');
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute('data-verdict')).toBe('falsch');
    expect(items[0]?.textContent).toContain('Falsch');
    const first = items[0];
    expect(first).toBeTruthy();
    if (first) fireEvent.click(first);
    expect(onShow).toHaveBeenCalledWith(CLAIM_ID);
  });

  it('offers a new talk, closes on Escape, and never scores people', () => {
    const onNewTalk = vi.fn();
    const onClose = vi.fn();
    render(<SummaryView claims={claims()} onShow={noop} onNewTalk={onNewTalk} onClose={onClose} />);
    expect(screen.getByTestId('summary-view').textContent).toContain('Keine Punkte pro Person');
    fireEvent.click(screen.getByTestId('summary-new'));
    expect(onNewTalk).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('counts the claims in the title and traps Tab in both directions', () => {
    const two = [
      ...claims().slice(0, 1),
      {
        claimId: OTHER_ID,
        text: 'b',
        submittedAt: '2026-09-26T10:05:00.000Z',
        checked: checked({ claimId: OTHER_ID, claim: 'b' }),
        explanationMissing: false,
      },
    ];
    render(<SummaryView claims={two} onShow={noop} onNewTalk={noop} onClose={noop} />);
    expect(screen.getByTestId('summary-view').textContent).toContain('Ein Abend, 2 Behauptungen');

    // aria-modal promises a trap: Tab on the last focusable wraps to the first and back.
    screen.getByTestId('summary-new').focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('summary-close');
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('summary-new');
  });

  it('returns the focus to the shown claim row, or to back when the row is gone', () => {
    const { unmount } = render(
      <SummaryView
        claims={claims()}
        onShow={noop}
        onNewTalk={noop}
        onClose={noop}
        focusClaimId={CLAIM_ID}
      />,
    );
    expect(document.activeElement?.getAttribute('data-claim-id')).toBe(CLAIM_ID);
    unmount();

    // OTHER_ID is never checked, so it has no row: the back button is the safe home.
    render(
      <SummaryView
        claims={claims()}
        onShow={noop}
        onNewTalk={noop}
        onClose={noop}
        focusClaimId={OTHER_ID}
      />,
    );
    expect(document.activeElement?.getAttribute('data-testid')).toBe('summary-close');
  });

  it('keeps an uncertain verdict neutral in the bar list (brief 11)', () => {
    render(
      <SummaryView
        claims={[
          {
            claimId: CLAIM_ID,
            text: 'a',
            submittedAt: '2026-09-26T10:00:00.000Z',
            checked: checked({ confidenceLevel: 'mittel' }),
            explanationMissing: false,
          },
        ]}
        onShow={noop}
        onNewTalk={noop}
        onClose={noop}
      />,
    );
    const item = screen.getByTestId('summary-item');
    expect(item.textContent).toContain('Unsicher: Falsch');
    expect(item.querySelector('svg')?.getAttribute('data-icon')).toBe('uncertain');
    expect(item.innerHTML).toContain('bg-line');
    expect(item.innerHTML).not.toContain('verdict-false"');
  });
});
