import L from 'leaflet';

import { useMapStore } from '../../../stores/mapStore';
import { type SelectedObject, useUiStore } from '../../../stores/uiStore';

/**
 * Selects a clicked map feature when the select tool is active.
 *
 * In any other tool the event is left to bubble to the map so drawing, measuring and placement
 * tools receive the click (markers bubble with their own position, which acts as a snap).
 * Returns whether the feature was selected.
 */
export function selectFeatureOnClick(event: L.LeafletMouseEvent, selection: SelectedObject): boolean {
  if (useMapStore.getState().activeTool !== 'select') return false;
  L.DomEvent.stopPropagation(event);
  const ui = useUiStore.getState();
  ui.select(selection);
  ui.setPanelOpen('right', true);
  return true;
}
