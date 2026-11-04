import type { CableType, Equipment } from '@fibergis/shared';

import { type BikerWaypoint, useBikerStore } from '../../stores/bikerStore';
import { useMapStore } from '../../stores/mapStore';
import { showToast } from '../../stores/toastStore';

/** Opens turn-by-turn navigation to a site in field (biker) mode. */
export function navigateToSite(target: BikerWaypoint): void {
  const biker = useBikerStore.getState();
  biker.navigateTo(target);
  biker.setBikerMode(true);
}

/** OLTs and ODFs feed main fiber; everything else keeps the cable type the user last picked. */
const STARTING_CABLE_TYPE: Partial<Record<Equipment['type'], CableType>> = {
  OLT: 'Main Feeder Fiber',
  ODF: 'Main Feeder Fiber',
};

/** Starts the cable sketch tool with its first vertex on the given equipment. */
export function startCableFrom(equipment: Equipment): void {
  const map = useMapStore.getState();
  const cableType = STARTING_CABLE_TYPE[equipment.type];
  if (cableType) map.setCableTypeToDraw(cableType);
  map.setDrawingPoints([[equipment.lat, equipment.lng]]);
  map.setActiveTool('draw_cable');
  showToast('info', `Drawing from ${equipment.name}`, 'Click the map to add route points, then press Enter to finish.');
}
