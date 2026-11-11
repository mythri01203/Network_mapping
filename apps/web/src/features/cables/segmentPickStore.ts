import { create } from 'zustand';

/**
 * Network mapping Phase 6: screen state for "tap two points on the cable" when recording a stretch.
 * Not network data: the taps become distances along the drawn line only when the person saves the
 * stretch. On a phone the panel closes while tapping, so the result waits here until the cable panel
 * opens again and picks it up.
 */

export interface SegmentPickJob {
  cableId: string;
  /** Set when changing a stretch already recorded. */
  segmentId?: string;
}

export interface SegmentPickResult extends SegmentPickJob {
  /** Metres along the drawn line, in the order tapped. */
  meters: [number, number];
}

interface SegmentPickState {
  job: SegmentPickJob | null;
  /** Distances tapped so far (0, 1 or 2). */
  taps: number[];
  result: SegmentPickResult | null;
  start: (job: SegmentPickJob) => void;
  tap: (meters: number) => void;
  undoTap: () => void;
  cancel: () => void;
  /** Hands the finished result to the panel once, then forgets it. */
  take: (cableId: string) => SegmentPickResult | null;
  /** One stretch drawn over its cable on the map ("Show on map"), until cleared. */
  highlight: { cableId: string; from: number; to: number } | null;
  showStretch: (highlight: { cableId: string; from: number; to: number } | null) => void;
}

export const useSegmentPickStore = create<SegmentPickState>()((set, get) => ({
  job: null,
  taps: [],
  result: null,
  start: (job) => set({ job, taps: [], result: null }),
  tap: (meters) => {
    const { job, taps } = get();
    if (!job) return;
    const next = [...taps, meters];
    if (next.length < 2) set({ taps: next });
    else set({ job: null, taps: [], result: { ...job, meters: [next[0], next[1]] } });
  },
  undoTap: () => set((s) => ({ taps: s.taps.slice(0, -1) })),
  cancel: () => set({ job: null, taps: [] }),
  take: (cableId) => {
    const result = get().result;
    if (!result || result.cableId !== cableId) return null;
    set({ result: null });
    return result;
  },
  highlight: null,
  showStretch: (highlight) => set({ highlight }),
}));
