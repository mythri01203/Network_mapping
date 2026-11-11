import { buildTraceGraph, type NetworkTraceData, type TraceGraph } from '@fibergis/shared';

import { selectColorSchemes, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { connectionIndexOf } from '../connections/connectionsUi';

/**
 * Network mapping Phase 15: the trace graph for the screens, built once per change of the records it
 * reads, on the same connection index the Connections panels use.
 */

type State = ReturnType<typeof useNetworkStore.getState>;

const KEYS = ['equipment', 'cables', 'splitters', 'closures', 'customers', 'onts', 'rfElements', 'rfLinks', 'linkVerifications', 'faults', 'services', 'buildings', 'cableSegments', 'ducts', 'attachments', 'spans', 'settings'] as const;

let cache: { inputs: Pick<State, (typeof KEYS)[number]>; graph: TraceGraph } | null = null;

export function traceGraphOf(state: State): TraceGraph {
  if (cache && KEYS.every((k) => cache!.inputs[k] === state[k])) return cache.graph;
  const schemes = selectColorSchemes(state);
  const data: NetworkTraceData = {
    equipment: state.equipment,
    cables: state.cables,
    splitters: state.splitters,
    closures: state.closures,
    customers: state.customers,
    onts: state.onts,
    rfElements: state.rfElements,
    rfLinks: state.rfLinks,
    linkVerifications: state.linkVerifications,
    faults: state.faults,
    services: state.services,
    buildings: state.buildings,
    cableSegments: state.cableSegments,
    ducts: state.ducts,
    attachments: state.attachments,
    spans: state.spans,
  };
  const index = connectionIndexOf({ equipment: state.equipment, cables: state.cables, splitters: state.splitters, closures: state.closures, customers: state.customers, onts: state.onts, rfElements: state.rfElements, rfLinks: state.rfLinks, linkVerifications: state.linkVerifications, schemes });
  const graph = buildTraceGraph(data, { schemes, settings: selectOpticalSettings(state), index });
  cache = { inputs: Object.fromEntries(KEYS.map((k) => [k, state[k]])) as Pick<State, (typeof KEYS)[number]>, graph };
  return graph;
}

/** The graph for the network in the store now. */
export const currentTraceGraph = (): TraceGraph => traceGraphOf(useNetworkStore.getState());
