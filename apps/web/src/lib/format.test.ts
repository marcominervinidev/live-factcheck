import { describe, expect, it } from 'vitest';

import { confidenceWidth, distribution, verdictDisplay } from './format';

describe('verdictDisplay', () => {
  it.each([
    ['stimmt', 'hoch', '✓', 'Stimmt', false],
    ['groesstenteils_richtig', 'hoch', '◐', 'Größtenteils richtig', false],
    ['uebertrieben', 'hoch', '!', 'Übertrieben', false],
    ['falsch', 'hoch', '✗', 'Falsch', false],
    ['nicht_pruefbar', 'niedrig', '?', 'Nicht prüfbar', false],
    ['falsch', 'mittel', '~', 'Unsicher: Falsch', true],
    ['nicht_pruefbar', 'mittel', '?', 'Nicht prüfbar', false],
  ] as const)('%s / %s → %s %s', (verdict, confidenceLevel, icon, label, uncertain) => {
    expect(verdictDisplay({ verdict, confidenceLevel })).toMatchObject({ icon, label, uncertain });
  });
});

describe('confidenceWidth and distribution', () => {
  it('clamps the bar and sorts the distribution', () => {
    expect(confidenceWidth(0.914)).toBe('91%');
    expect(confidenceWidth(1.3)).toBe('100%');
    expect(
      distribution({
        stimmt: 0.1,
        groesstenteils_richtig: 0.05,
        uebertrieben: 0.05,
        falsch: 0.78,
        nicht_pruefbar: 0.02,
      })[0],
    ).toEqual({ verdict: 'falsch', label: 'Falsch', percent: 78 });
  });
});
