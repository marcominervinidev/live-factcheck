import type { TranscriptSegment } from '@lfc/contracts';
import { create } from 'zustand';

interface TranscriptStore {
  segments: Readonly<Record<string, TranscriptSegment>>;
  /** Oldest first, by start time; segments can arrive out of order. */
  order: readonly string[];
  apply: (segment: TranscriptSegment) => void;
  reset: () => void;
}

/**
 * The live transcript of the session (brief 6.4, 11; ADR 0015). Interim and final versions of one
 * utterance share the `segmentId`: each version replaces the previous one, and a final segment is
 * never replaced by a late interim.
 */
export const useTranscript = create<TranscriptStore>((set) => ({
  segments: {},
  order: [],
  apply: (segment) => {
    set((state) => {
      const current = state.segments[segment.segmentId];
      if (current?.isFinal === true && !segment.isFinal) return state;
      const segments = { ...state.segments, [segment.segmentId]: segment };
      if (current !== undefined) return { segments, order: state.order };
      const order = [...state.order];
      let index = order.length;
      while (index > 0 && (segments[order[index - 1] ?? '']?.startMs ?? 0) > segment.startMs)
        index -= 1;
      order.splice(index, 0, segment.segmentId);
      return { segments, order };
    });
  },
  reset: () => {
    set({ segments: {}, order: [] });
  },
}));
