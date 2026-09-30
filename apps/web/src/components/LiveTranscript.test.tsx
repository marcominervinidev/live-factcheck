import type { TranscriptSegment } from '@lfc/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useClaims } from '../state/claims';
import { useTranscript } from '../state/transcript';
import { CLAIM_ID, SESSION_ID, checked, detected } from '../testing/fixtures';

import { LiveTranscript } from './LiveTranscript';

const SEGMENT_A = '11111111-1111-4111-8111-111111111111';
const SEGMENT_B = '22222222-2222-4222-8222-222222222222';

const segment = (
  segmentId: string,
  text: string,
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  segmentId,
  speaker: 'A',
  text,
  startMs: 0,
  endMs: 1_000,
  isFinal: true,
  language: 'de',
  ...overrides,
});

describe('LiveTranscript (T6.3)', () => {
  beforeEach(() => {
    useTranscript.getState().reset();
    useClaims.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders nothing before the first segment', () => {
    render(<LiveTranscript />);
    expect(screen.queryByTestId('transcript')).toBeNull();
  });

  it('shows speaker letters, interim text grey and final text black', () => {
    render(<LiveTranscript />);
    act(() => {
      useTranscript.getState().apply(segment(SEGMENT_A, 'Guten Abend zusammen.'));
      useTranscript
        .getState()
        .apply(segment(SEGMENT_B, 'Der Zweite', { speaker: 'B', startMs: 2_000, isFinal: false }));
    });
    const rows = screen.getAllByTestId('transcript-segment');
    expect(rows.map((r) => r.dataset['final'])).toEqual(['true', 'false']);
    expect(rows[0]?.textContent).toBe('Sprecher AGuten Abend zusammen.');
    expect(rows[1]?.textContent).toContain('Sprecher B');
    expect(rows[1]?.querySelector('.italic')?.textContent).toBe('Der Zweite');
  });

  it('marks a detected claim as being checked, then in the verdict colour with text, linked to its card', () => {
    render(<LiveTranscript />);
    act(() => {
      useTranscript.getState().apply(segment(SEGMENT_A, 'Der Zweite Weltkrieg endete 1965.'));
      useClaims.getState().applyEvent({
        type: 'claim.detected',
        schemaVersion: 2,
        payload: detected({ sourceSegmentIds: [SEGMENT_A] }),
      });
    });
    const mark = screen.getByTestId('transcript-claim');
    expect(mark.dataset['state']).toBe('checking');
    expect(mark.getAttribute('href')).toBe(`#claim-${CLAIM_ID}`);
    expect(mark.textContent).toContain('wird geprüft');

    act(() => {
      useClaims.getState().applyEvent({
        type: 'claim.checked',
        schemaVersion: 2,
        payload: checked({ verdict: 'falsch', confidenceLevel: 'hoch' }),
      });
    });
    const done = screen.getByTestId('transcript-claim');
    expect(done.dataset['state']).toBe('checked');
    // Colour is never the only signal: icon and label are in the text.
    expect(done.textContent).toContain('Falsch');
    expect(done.getAttribute('aria-label')).toContain('Falsch');
  });
});
