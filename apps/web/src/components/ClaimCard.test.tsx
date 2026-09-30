import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClaimView } from '../state/claims';
import { CLAIM_ID, checked, detected, explained } from '../testing/fixtures';
import { ClaimCard } from './ClaimCard';

/** Visible text of an element (no jest-dom in this project). */
const text = (element: HTMLElement) => element.textContent;

const view = (overrides: Partial<ClaimView> = {}): ClaimView => ({
  claimId: CLAIM_ID,
  text: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  submittedAt: '2026-09-26T10:00:00.000Z',
  explanationMissing: false,
  ...overrides,
});

describe('ClaimCard (brief 11)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows "wird geprüft" before the verdict, always with the disclaimer', () => {
    render(<ClaimCard claim={view({ detected: detected() })} />);
    expect(text(screen.getByTestId('verdict-pending'))).toContain('Wird geprüft');
    expect(text(screen.getByTestId('disclaimer'))).toContain('Automatische Einschätzung');
  });

  it('shows verdict chip with icon and text, confidence, best evidence, badges and sources', () => {
    render(<ClaimCard claim={view({ detected: detected(), checked: checked() })} />);
    const chip = screen.getByTestId('verdict-chip');
    expect(text(chip)).toContain('✗');
    expect(text(chip)).toContain('Falsch');
    expect(text(screen.getByTestId('confidence'))).toContain('hoch');
    expect(text(screen.getByTestId('best-evidence'))).toContain(
      '„Der Zweite Weltkrieg endete am 2. September 1945.“',
    );
    expect(text(screen.getByTestId('best-evidence'))).toContain(
      'Wikipedia · 8. Mai 2025 · Nachschlagewerk',
    );
    expect(text(screen.getByTestId('badge-existing'))).toContain(
      'Bereits von CORRECTIV geprüft: Falsch',
    );
    const link = within(screen.getByTestId('sources')).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://de.wikipedia.org/wiki/Zweiter_Weltkrieg');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(text(screen.getByTestId('explanation'))).toContain('Erklärung folgt');
  });

  it('marks medium confidence as "unsicher" in a neutral colour, not red or green', () => {
    render(
      <ClaimCard
        claim={view({
          checked: checked({
            verdict: 'stimmt',
            probabilities: {
              stimmt: 0.65,
              groesstenteils_richtig: 0.2,
              uebertrieben: 0.1,
              falsch: 0.03,
              nicht_pruefbar: 0.02,
            },
            confidence: 0.56,
            confidenceLevel: 'mittel',
          }),
        })}
      />,
    );
    const chip = screen.getByTestId('verdict-chip');
    expect(text(chip)).toContain('Unsicher: Stimmt');
    expect(chip.getAttribute('data-uncertain')).toBe('true');
    expect(chip.className).toContain('bg-verdict-open-soft');
    expect(chip.className).not.toMatch(/verdict-true|verdict-false/);
  });

  it('explains nicht_pruefbar with its reason instead of a confidence bar', () => {
    render(
      <ClaimCard
        claim={view({
          checked: checked({
            verdict: 'nicht_pruefbar',
            confidence: 0.2,
            confidenceLevel: 'niedrig',
            reason: 'no_evidence',
            evidence: [],
            bestEvidenceId: undefined,
            existingFactCheck: undefined,
          }),
        })}
      />,
    );
    expect(text(screen.getByTestId('verdict-chip'))).toContain('Nicht prüfbar');
    expect(text(screen.getByTestId('reason'))).toContain('keine ausreichenden Belege');
    expect(screen.queryByTestId('confidence')).toBeNull();
  });

  it('shows the explanation when it arrives and a clear message when it never does', () => {
    const { rerender } = render(
      <ClaimCard claim={view({ checked: checked(), explained: explained() })} />,
    );
    expect(text(screen.getByTestId('explanation'))).toContain('vor über 80 Jahren');
    rerender(<ClaimCard claim={view({ checked: checked(), explanationMissing: true })} />);
    expect(text(screen.getByTestId('explanation'))).toContain('Keine Erklärung verfügbar');
  });

  it('shows the cache badge and the literal wording when it differs from the standalone claim', () => {
    render(
      <ClaimCard
        claim={view({
          detected: detected({ originalText: 'Der ist doch erst 20 Jahre vorbei.' }),
          checked: checked({ cacheHit: 'verdict_exact', existingFactCheck: undefined }),
        })}
      />,
    );
    expect(text(screen.getByTestId('badge-cached'))).toContain('Aus früherer Prüfung');
    expect(screen.getByText('„Der ist doch erst 20 Jahre vorbei.“')).toBeTruthy();
  });

  it('shows no percentage prominently, only in the details (brief 7)', () => {
    render(<ClaimCard claim={view({ checked: checked() })} />);
    expect(text(screen.getByTestId('confidence'))).not.toContain('%');
    expect(text(screen.getByTestId('distribution'))).toContain('Falsch93 %');
  });
});
