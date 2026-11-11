import L from 'leaflet';

import { useMapStore } from '../../../stores/mapStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { type SelectedObject, useUiStore } from '../../../stores/uiStore';
import { keyForSelection } from '../../selection/selectionModel';

/**
 * Selects a clicked map feature when the select tool is active and nothing else is waiting for a tap.
 *
 * Otherwise the event goes on to the map, so drawing, measuring, placing, moving, location picking
 * and drawing a selection area receive it. Markers report their own position, which joins a cable
 * exactly onto them. Returns whether the feature was selected.
 *
 * Phase 16: with Shift, Ctrl or Cmd held, or "Select several" on (phones), the tap adds the item to
 * the selection set or takes it out, and the inspector stays as it is.
 */
export function selectFeatureOnClick(event: L.LeafletMouseEvent, selection: SelectedObject): boolean {
  const map = useMapStore.getState();
  const ui = useUiStore.getState();
  const picking = useSelectionStore.getState();
  if (map.activeTool !== 'select' || map.movingEquipmentId || ui.pickingOnuCustomer || ui.customerWizardPicking || picking.areaTool) {
    return false;
  }
  L.DomEvent.stopPropagation(event);
  const original = event.originalEvent as MouseEvent | undefined;
  if (picking.multiMode || original?.shiftKey || original?.ctrlKey || original?.metaKey) {
    picking.toggle(keyForSelection(selection));
    return true;
  }
  ui.select(selection);
  // On a phone the panel would cover the map; a small bar offers Details instead.
  if (typeof window === 'undefined' || window.innerWidth >= 768) ui.setPanelOpen('right', true);
  return true;
}
