import { create } from 'zustand';

import type { LatLng, MoveChoices, MovePreview } from '@fibergis/shared';

/**
 * Phase 4: screen state for outside plant that is not network data: a shape being drawn (a span's
 * bends, a building outline), the ducts highlighted by an underground trace, and the open "what
 * else moves with this pole?" question.
 */

export type OspDrawJob = { kind: 'spanRoute'; spanId: string } | { kind: 'footprint'; buildingId: string };

interface PendingMove {
  preview: MovePreview;
  to: LatLng;
  resolve: (choices: MoveChoices | null) => void;
}

interface OspUiState {
  draw: OspDrawJob | null;
  points: LatLng[];
  startDraw: (job: OspDrawJob) => void;
  addPoint: (point: LatLng) => void;
  undoPoint: () => void;
  stopDraw: () => void;

  /** Ducts the last underground trace reached, highlighted on the map until cleared. */
  tracedDuctIds: string[];
  showTrace: (ductIds: string[]) => void;
  clearTrace: () => void;

  pendingMove: PendingMove | null;
  /** Asks what else should move with a structure. Resolves with the ticked choices, or null for "do not move". */
  requestMove: (preview: MovePreview, to: LatLng) => Promise<MoveChoices | null>;
  answerMove: (choices: MoveChoices | null) => void;
}

export const useOspUiStore = create<OspUiState>()((set, get) => ({
  draw: null,
  points: [],
  startDraw: (draw) => set({ draw, points: [] }),
  addPoint: (point) => set((s) => (s.draw ? { points: [...s.points, point] } : {})),
  undoPoint: () => set((s) => ({ points: s.points.slice(0, -1) })),
  stopDraw: () => set({ draw: null, points: [] }),

  tracedDuctIds: [],
  showTrace: (tracedDuctIds) => set({ tracedDuctIds }),
  clearTrace: () => {
    if (get().tracedDuctIds.length > 0) set({ tracedDuctIds: [] });
  },

  pendingMove: null,
  requestMove: (preview, to) =>
    new Promise<MoveChoices | null>((resolve) => {
      // A newer question replaces an unanswered one, which counts as "do not move".
      get().pendingMove?.resolve(null);
      set({ pendingMove: { preview, to, resolve } });
    }),
  answerMove: (choices) => {
    const pending = get().pendingMove;
    if (!pending) return;
    set({ pendingMove: null });
    pending.resolve(choices);
  },
}));
