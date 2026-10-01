import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checked, detected, explained } from '../testing/fixtures';

import { ShowClaim } from './ShowClaim';

const view = () => ({
  claimId: checked().claimId,
  text: 'tippte',
  submittedAt: '2026-09-26T10:00:00.000Z',
  detected: detected({ originalText: 'Der ist doch erst 20 Jahre vorbei.' }),
  checked: checked(),
  explained: explained(),
  explanationMissing: false,
});

describe('ShowClaim (T6.5, Zeigen)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the literal words, the verdict with its icon, the correction and sources', () => {
    render(<ShowClaim claim={view()} checked={checked()} onClose={() => undefined} />);
    expect(screen.getByTestId('show-said').textContent).toContain(
      'Der ist doch erst 20 Jahre vorbei.',
    );
    const verdict = screen.getByTestId('show-verdict');
    expect(verdict.textContent).toContain('Falsch');
    expect(verdict.querySelector('svg')?.getAttribute('data-icon')).toBe('false');
    expect(screen.getByTestId('show-claim').textContent).toBe(checked().claim);
    const links = [...screen.getByTestId('show-sources').querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      // Handing the phone across the table must never hand over the session (security review).
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('href')).toMatch(/^https?:\/\//);
      expect(link.textContent).toContain('Nachschlagewerk');
    }
  });

  it('closes on the back button and on Escape, never suggesting certainty when uncertain', () => {
    const onClose = vi.fn();
    render(
      <ShowClaim
        claim={view()}
        checked={checked({ confidenceLevel: 'mittel' })}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('show-verdict').textContent).toContain('Unsicher: Falsch');
    fireEvent.click(screen.getByTestId('show-back'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside the overlay (aria-modal promise)', () => {
    render(<ShowClaim claim={view()} checked={checked()} onClose={() => undefined} />);
    const back = screen.getByTestId('show-back');
    const links = screen.getByTestId('show-sources').querySelectorAll('a');
    const last = links[links.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
