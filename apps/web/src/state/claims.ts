import type { ClaimChecked, ClaimDetected, ClaimExplained, EventEnvelope } from '@lfc/contracts';
import { create } from 'zustand';

/** Everything the UI knows about one claim, assembled from its events (brief 6, 11). */
export interface ClaimView {
  readonly claimId: string;
  /** What the user typed; replaced by the detected event's wording when it arrives. */
  readonly text: string;
  readonly submittedAt: string;
  readonly detected?: ClaimDetected;
  readonly checked?: ClaimChecked;
  readonly explained?: ClaimExplained;
  /** The explanation did not arrive in time; the card says so instead of waiting forever. */
  readonly explanationMissing: boolean;
}

interface ClaimsStore {
  claims: Readonly<Record<string, ClaimView>>;
  /** Newest first (brief 11). */
  order: readonly string[];
  addSubmitted: (claimId: string, text: string, submittedAt: string) => void;
  applyEvent: (event: EventEnvelope) => void;
  markExplanationMissing: (claimId: string) => void;
  reset: () => void;
}

type ClaimsState = Pick<ClaimsStore, 'claims' | 'order'>;

/** Creates the claim if it is new (newest first) and applies `update`. */
function upsert(
  state: ClaimsState,
  claimId: string,
  update: (current: ClaimView) => ClaimView,
  fallback: () => ClaimView,
): ClaimsState {
  const current = state.claims[claimId];
  return {
    claims: { ...state.claims, [claimId]: update(current ?? fallback()) },
    order: current === undefined ? [claimId, ...state.order] : state.order,
  };
}

/** Updates an existing claim only; unknown ids leave the state unchanged. */
function updateExisting(
  state: ClaimsState,
  claimId: string,
  update: (current: ClaimView) => ClaimView,
): ClaimsState {
  const current = state.claims[claimId];
  return current === undefined
    ? state
    : { ...state, claims: { ...state.claims, [claimId]: update(current) } };
}

export const useClaims = create<ClaimsStore>((set) => ({
  claims: {},
  order: [],
  addSubmitted: (claimId, text, submittedAt) => {
    set((state) =>
      upsert(
        state,
        claimId,
        (current) => current,
        () => ({ claimId, text, submittedAt, explanationMissing: false }),
      ),
    );
  },
  applyEvent: (event) => {
    switch (event.type) {
      case 'claim.detected': {
        const payload = event.payload;
        set((state) =>
          upsert(
            state,
            payload.claimId,
            (current) => ({ ...current, text: payload.originalText, detected: payload }),
            () => ({
              claimId: payload.claimId,
              text: payload.originalText,
              submittedAt: payload.detectedAt,
              explanationMissing: false,
            }),
          ),
        );
        break;
      }
      case 'claim.checked': {
        const payload = event.payload;
        set((state) =>
          upsert(
            state,
            payload.claimId,
            (current) => ({ ...current, checked: payload }),
            () => ({
              claimId: payload.claimId,
              text: payload.claim,
              submittedAt: payload.checkedAt,
              explanationMissing: false,
            }),
          ),
        );
        break;
      }
      case 'claim.explained': {
        const payload = event.payload;
        // An explanation without a known claim is ignored: the card would have no verdict.
        set((state) =>
          updateExisting(state, payload.claimId, (current) => ({
            ...current,
            explained: payload,
            explanationMissing: false,
          })),
        );
        break;
      }
      case 'transcript.segment':
      case 'topic.detected':
        // Shown from phase 2 (transcript) and phase 4 (topics) on.
        break;
    }
  },
  markExplanationMissing: (claimId) => {
    set((state) =>
      updateExisting(state, claimId, (current) =>
        current.explained === undefined ? { ...current, explanationMissing: true } : current,
      ),
    );
  },
  reset: () => {
    set({ claims: {}, order: [] });
  },
}));
