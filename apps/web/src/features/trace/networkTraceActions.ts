import {
  boundsOf,
  type LatLng,
  type NetworkTraceResult,
  runNetworkTrace,
  type TraceGraph,
  type TracePoint,
  type TraceRequest,
  traceSteps,
  type TraceType,
} from '@fibergis/shared';

import { useMapStore } from '../../stores/mapStore';
import { showToast } from '../../stores/toastStore';
import { useTraceStore } from '../../stores/traceStore';
import { currentTraceGraph } from './traceGraph';

/**
 * Network mapping Phase 15: run a trace with the one engine, highlight it on the map and open the
 * trace screen. Every trace highlights its cables and items, fibre-level traces included.
 */

/** The trace a point opens with: an OLT or its port shows what it feeds, a fault who it affects, anything else the way to the OLT. */
export function defaultTraceType(g: TraceGraph, point: TracePoint): TraceType {
  if (point.type === 'pon_port') return 'olt_to_ont';
  if (point.type === 'equipment' && g.equipment.get(point.id)?.type === 'OLT') return 'olt_to_ont';
  if (point.type === 'fault') return 'fault_impact';
  if (point.type === 'service') return 'logical_service';
  if (point.type === 'customer' || point.type === 'ont') return 'customer_to_olt';
  return 'upstream';
}

export function runTrace(request: TraceRequest): NetworkTraceResult {
  const result = runNetworkTrace(currentTraceGraph(), request);
  useTraceStore.getState().showNetwork(request, result);
  return result;
}

/** Opens the trace screen; with a request, runs it first and says the result in one line. */
export function openNetworkTrace(request?: TraceRequest): NetworkTraceResult | null {
  const store = useTraceStore.getState();
  if (!request) {
    store.openPanel();
    return null;
  }
  const result = runTrace(request);
  store.openPanel(request);
  showToast(
    result.complete ? 'info' : 'warning',
    result.complete ? 'Trace shown on the map' : 'Trace: path not complete',
    `${result.fromLabel}: ${result.counts.steps} steps${result.gaps.length ? `, ${result.gaps.length} missing link(s)` : ''}${result.counts.unverified ? `, ${result.counts.unverified} not checked` : ''}.`,
  );
  return result;
}

/** Zooms the map to everything in a trace that has a position. */
export function showTraceOnMap(result: NetworkTraceResult): boolean {
  const points: LatLng[] = traceSteps(result)
    .map(({ step }) => step)
    .filter((s) => s.lat !== undefined && s.lng !== undefined)
    .map((s) => [s.lat!, s.lng!] as LatLng);
  const bounds = boundsOf(points);
  if (!bounds) return false;
  useMapStore.getState().fitBounds(bounds);
  return true;
}
