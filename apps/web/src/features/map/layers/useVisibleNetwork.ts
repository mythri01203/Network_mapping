import { useMemo } from 'react';

import type { Cable, Equipment } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { isCableVisible, isEquipmentVisible, type OltFilter } from '../layerFilters';

/** Equipment that passes the network-mode, layer and OLT-technology filters. */
export function useVisibleEquipment(oltFilter: OltFilter): Equipment[] {
  const equipment = useNetworkStore((s) => s.equipment);
  const networkMode = useUiStore((s) => s.networkMode);
  const layers = useMapStore((s) => s.layers);
  return useMemo(
    () => equipment.filter((eq) => isEquipmentVisible(eq, { networkMode, layers, oltFilter })),
    [equipment, networkMode, layers, oltFilter],
  );
}

/** Cables that pass the network-mode and layer filters. */
export function useVisibleCables(): Cable[] {
  const cables = useNetworkStore((s) => s.cables);
  const networkMode = useUiStore((s) => s.networkMode);
  const layers = useMapStore((s) => s.layers);
  return useMemo(
    () => cables.filter((cable) => isCableVisible(cable, { networkMode, layers })),
    [cables, networkMode, layers],
  );
}
