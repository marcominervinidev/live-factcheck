import type { TranscriptSegment } from '@lfc/contracts';
import { create } from 'zustand';

interface TranscriptStore {
  segments: Readonly<Record<string, TranscriptSegment>>;
  /** Oldest first: by recording epoch, then start time; segments can arrive out of order. */
  order: readonly string[];
  /** Sort epoch per segment: every recording's clock restarts at zero (`startMs` is relative). */
  epochs: Readonly<Record<string, number>>;
  epoch: number;
  apply: (segment: TranscriptSegment) => void;
  /** A new recording started: its sentences belong after everything already shown. */
  beginEpoch: () => void;
  reset: () => void;
}

/**
 * The live transcript of the session (brief 6.4, 11; ADR 0015). Interim and final versions of one
 * utterance share the `segmentId`: each version replaces the previous one, and a final segment is
 * never replaced by a late interim. `startMs` restarts at zero with every recording, so ordering
 * uses the recording epoch first - without it, a later recording's sentences sorted into the
 * middle of the earlier ones (owner finding 2026-10-01).
 */
export const useTranscript = create<TranscriptStore>((set) => ({
  segments: {},
  order: [],
  epochs: {},
  epoch: 0,
  apply: (segment) => {
    set((state) => {
      const current = state.segments[segment.segmentId];
      if (current?.isFinal === true && !segment.isFinal) return state;
      const segments = { ...state.segments, [segment.segmentId]: segment };
      // A replacement keeps its slot in the order, and with it its original epoch.
      if (current !== undefined) return { segments, order: state.order };
      const epochs = { ...state.epochs, [segment.segmentId]: state.epoch };
      const order = [...state.order];
      let index = order.length;
      while (index > 0) {
        const previousId = order[index - 1] ?? '';
        const previousEpoch = epochs[previousId] ?? 0;
        if (previousEpoch < state.epoch) break;
        if (
          previousEpoch === state.epoch &&
          (segments[previousId]?.startMs ?? 0) <= segment.startMs
        )
          break;
        index -= 1;
      }
      order.splice(index, 0, segment.segmentId);
      return { segments, order, epochs };
    });
  },
  beginEpoch: () => {
    set((state) => ({ epoch: state.epoch + 1 }));
  },
  reset: () => {
    set({ segments: {}, order: [], epochs: {}, epoch: 0 });
  },
}));
