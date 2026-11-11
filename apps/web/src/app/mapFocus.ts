import { boundsOf, hasRecordedLocation, type LatLngBounds } from '@fibergis/shared';

import type { FlyToTarget } from '../stores/mapStore';
import type { SelectedObject } from '../stores/uiStore';

export const POINT_FOCUS_ZOOM = 18;
export const ROUTE_FOCUS_ZOOM = 17;

/** The box that shows the whole of a route (cable or duct), or `null` for anything else or a route of under two points. */
export function boundsFor(selection: SelectedObject): LatLngBounds | null {
  if (selection.type !== 'cable' && selection.type !== 'duct') return null;
  const coords = selection.data.coordinates;
  return coords.length >= 2 ? boundsOf(coords) : null;
}

/** Where the map should centre to show a selected object, or `null` when it has no usable location. */
export function focusFor(selection: SelectedObject): FlyToTarget | null {
  switch (selection.type) {
    case 'fault':
      return { ...selection.data.affectedLocation, zoom: POINT_FOCUS_ZOOM };
    // A span has no position of its own; its inspector shows its two poles.
    case 'span':
      return null;
    case 'cable':
    case 'duct': {
      const coords = selection.data.coordinates;
      if (coords.length === 0) return null;
      const [lat, lng] = coords[Math.floor(coords.length / 2)];
      return { lat, lng, zoom: ROUTE_FOCUS_ZOOM };
    }
    default: {
      const { lat, lng } = selection.data;
      return hasRecordedLocation({ lat, lng }) ? { lat, lng, zoom: POINT_FOCUS_ZOOM } : null;
    }
  }
}
