import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CLAIM_ID, checked } from '../testing/fixtures';

import { Timeline } from './Timeline';

const OTHER_ID = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

describe('Timeline (brief 11)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing without claims', () => {
    render(<Timeline claims={[]} />);
    expect(screen.queryByTestId('timeline')).toBeNull();
  });

  it('shows one dot per claim, oldest first, linking to its card', () => {
    render(
      <Timeline
        claims={[
          // Newest first, as in the store.
          {
            claimId: OTHER_ID,
            text: 'b',
            submittedAt: '2026-09-26T10:05:00.000Z',
            explanationMissing: false,
          },
          {
            claimId: CLAIM_ID,
            text: 'a',
            submittedAt: '2026-09-26T10:00:00.000Z',
            checked: checked(),
            explanationMissing: false,
          },
        ]}
      />,
    );
    const dots = screen.getAllByTestId('timeline-dot');
    expect(dots.map((dot) => dot.getAttribute('href'))).toEqual([
      `#claim-${CLAIM_ID}`,
      `#claim-${OTHER_ID}`,
    ]);
    expect(dots[1]?.getAttribute('aria-label')).toContain('Wird geprüft …');
    expect(dots[0]?.getAttribute('aria-label')).not.toContain('Wird geprüft');
  });
});
