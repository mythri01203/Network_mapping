import { useMemo } from 'react';
import type L from 'leaflet';

import { type Cable, type Equipment, segmentInstallMethods } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { isCableVisible, isEquipmentVisible, type OltFilter, shownAtZoom } from '../layerFilters';
import { useMapZoom } from '../leaflet/useLeafletMap';

/** Equipment that passes the network-mode, layer, zoom and OLT-technology filters. */
export function useVisibleEquipment(oltFilter: OltFilter, zoom?: number): Equipment[] {
  const equipment = useNetworkStore((s) => s.equipment);
  const networkMode = useUiStore((s) => s.networkMode);
  const layers = useMapStore((s) => s.layers);
  const layerMinZoom = useMapStore((s) => s.layerMinZoom);
  return useMemo(
    () => equipment.filter((eq) => isEquipmentVisible(eq, { networkMode, layers, oltFilter, zoom, layerMinZoom })),
    [equipment, networkMode, layers, oltFilter, zoom, layerMinZoom],
  );
}

/** Cables that pass the network-mode, layer and zoom filters. */
export function useVisibleCables(zoom?: number): Cable[] {
  const cables = useNetworkStore((s) => s.cables);
  const networkMode = useUiStore((s) => s.networkMode);
  const layers = useMapStore((s) => s.layers);
  const layerMinZoom = useMapStore((s) => s.layerMinZoom);
  // Network mapping Phase 6: install methods recorded on cable stretches (a mixed cable is in both install layers).
  const segments = useNetworkStore((s) => s.cableSegments);
  const segmentMethods = useMemo(() => segmentInstallMethods(segments ?? []), [segments]);
  return useMemo(
    () => cables.filter((cable) => isCableVisible(cable, { networkMode, layers, zoom, layerMinZoom, segmentMethods })),
    [cables, networkMode, layers, zoom, layerMinZoom, segmentMethods],
  );
}

/** Whether a simple on/off layer is drawn now: switched on, and the map is zoomed in to its "show from" zoom. */
export function useLayerShown(map: L.Map, layer: string): boolean {
  const on = useMapStore((s) => s.layers[layer] !== false);
  const minZoom = useMapStore((s) => s.layerMinZoom[layer]);
  const zoom = useMapZoom(map);
  return on && shownAtZoom(layer, zoom, minZoom === undefined ? undefined : { [layer]: minZoom });
}
