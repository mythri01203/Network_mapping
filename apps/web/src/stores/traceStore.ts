import { create } from 'zustand';

import type { NetworkTraceResult, TracePathNode, TraceRequest, TraceResult, TraceSummary } from '@fibergis/shared';

export interface TraceState {
  /** The cable-level route trace (`trace.ts`), shown by the route trace screen and the bottom panel. */
  path: TracePathNode[] | null;
  /** Highlighted on the map, whichever trace is shown. */
  cableIds: string[];
  equipmentIds: string[];
  summary: TraceSummary | null;
  /** Network mapping Phase 15: the fibre-level trace (one engine on the connection index). */
  network: NetworkTraceResult | null;
  request: TraceRequest | null;
  /** The network trace screen is open. */
  panelOpen: boolean;
  show: (result: TraceResult) => void;
  showNetwork: (request: TraceRequest, result: NetworkTraceResult) => void;
  openPanel: (request?: TraceRequest | null) => void;
  closePanel: () => void;
  clear: () => void;
}

const EMPTY_TRACE = { path: null, cableIds: [], equipmentIds: [], summary: null, network: null, request: null } satisfies Partial<TraceState>;

export const useTraceStore = create<TraceState>()((set, get) => ({
  ...EMPTY_TRACE,
  panelOpen: false,
  show: (result) =>
    set({ path: result.nodes, cableIds: result.cableIds, equipmentIds: result.equipmentIds, summary: result.summary, network: null }),
  showNetwork: (request, result) =>
    set({ request, network: result, cableIds: result.cableIds, equipmentIds: result.equipmentIds, path: null, summary: null }),
  openPanel: (request) => set((s) => ({ panelOpen: true, request: request === undefined ? s.request : request })),
  closePanel: () => set({ panelOpen: false }),
  clear: () => {
    const s = get();
    if (s.path !== null || s.cableIds.length > 0 || s.network !== null || s.request !== null) set(EMPTY_TRACE);
  },
}));
