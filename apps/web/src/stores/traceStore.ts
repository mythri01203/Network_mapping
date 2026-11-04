import { create } from 'zustand';
import type { TracePathNode, TraceResult, TraceSummary } from '@fibergis/shared';

export interface TraceState {
  path: TracePathNode[] | null;
  cableIds: string[];
  equipmentIds: string[];
  summary: TraceSummary | null;
  show: (result: TraceResult) => void;
  clear: () => void;
}

const EMPTY_TRACE = { path: null, cableIds: [], equipmentIds: [], summary: null } satisfies Partial<TraceState>;

export const useTraceStore = create<TraceState>()((set, get) => ({
  ...EMPTY_TRACE,
  show: (result) =>
    set({ path: result.nodes, cableIds: result.cableIds, equipmentIds: result.equipmentIds, summary: result.summary }),
  clear: () => {
    if (get().path !== null || get().cableIds.length > 0) set(EMPTY_TRACE);
  },
}));
