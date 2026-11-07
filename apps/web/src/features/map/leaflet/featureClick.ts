import L from 'leaflet';

import { useMapStore } from '../../../stores/mapStore';
import { type SelectedObject, useUiStore } from '../../../stores/uiStore';

/**
 * Selects a clicked map feature when the select tool is active and nothing else is waiting for a tap.
 *
 * Otherwise the event goes on to the map, so drawing, measuring, placing, moving and location
 * picking receive it. Markers report their own position, which joins a cable exactly onto them.
 * Returns whether the feature was selected.
 */
export function selectFeatureOnClick(event: L.LeafletMouseEvent, selection: SelectedObject): boolean {
  const map = useMapStore.getState();
  const ui = useUiStore.getState();
  if (map.activeTool !== 'select' || map.movingEquipmentId || ui.pickingOnuCustomer || ui.customerWizardPicking) {
    return false;
  }
  L.DomEvent.stopPropagation(event);
  ui.select(selection);
  // On a phone the panel would cover the map; a small bar offers Details instead.
  if (typeof window === 'undefined' || window.innerWidth >= 768) ui.setPanelOpen('right', true);
  return true;
}
