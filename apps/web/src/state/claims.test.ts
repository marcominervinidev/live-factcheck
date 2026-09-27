import { beforeEach, describe, expect, it } from 'vitest';

import { CLAIM_ID, checked, detected, explained } from '../testing/fixtures';
import { useClaims } from './claims';

const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('claims store', () => {
  beforeEach(() => {
    useClaims.getState().reset();
  });

  it('assembles a claim from submit, detected, checked and explained', () => {
    const store = useClaims.getState();
    store.addSubmitted(CLAIM_ID, 'getippt', '2026-09-26T10:00:00.000Z');
    store.applyEvent({ type: 'claim.detected', schemaVersion: 2, payload: detected() });
    store.applyEvent({ type: 'claim.checked', schemaVersion: 2, payload: checked() });
    store.applyEvent({ type: 'claim.explained', schemaVersion: 2, payload: explained() });
    const claim = useClaims.getState().claims[CLAIM_ID];
    expect(claim).toMatchObject({
      text: detected().originalText,
      checked: checked(),
      explained: explained(),
    });
    expect(useClaims.getState().order).toEqual([CLAIM_ID]);
  });

  it('orders newest first and ignores explanations of unknown claims', () => {
    const store = useClaims.getState();
    store.applyEvent({ type: 'claim.checked', schemaVersion: 2, payload: checked() });
    store.applyEvent({
      type: 'claim.checked',
      schemaVersion: 2,
      payload: checked({ claimId: OTHER }),
    });
    store.applyEvent({
      type: 'claim.explained',
      schemaVersion: 2,
      payload: explained({ claimId: '11111111-2222-4333-8444-555555555555' }),
    });
    expect(useClaims.getState().order).toEqual([OTHER, CLAIM_ID]);
    expect(Object.keys(useClaims.getState().claims)).toHaveLength(2);
  });

  it('marks a missing explanation only while none has arrived', () => {
    const store = useClaims.getState();
    store.applyEvent({ type: 'claim.checked', schemaVersion: 2, payload: checked() });
    store.applyEvent({ type: 'claim.explained', schemaVersion: 2, payload: explained() });
    store.markExplanationMissing(CLAIM_ID);
    expect(useClaims.getState().claims[CLAIM_ID]?.explanationMissing).toBe(false);
  });
});
