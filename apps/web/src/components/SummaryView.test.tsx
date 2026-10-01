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
    expect(screen.getByTestId('summary-view').textContent).toContain(
      'Ein Gespräch, eine Behauptung',
    );
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
});
