import {
  boundsOf,
  type Cable,
  type Customer,
  type Duct,
  type Equipment,
  hasPlacedPosition,
  hasRecordedLocation,
  isValidCoordinate,
  type LatLng,
  type LatLngBounds,
  type NetworkZone,
} from '@fibergis/shared';

export interface ExtentData {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  customers: readonly Customer[];
  ducts?: readonly Duct[];
  zones?: readonly NetworkZone[];
}

const usable = ([lat, lng]: LatLng) => isValidCoordinate(lat, lng) && hasRecordedLocation({ lat, lng });

/**
 * The box around everything that has a real place on the map: placed pins, drawn routes, customers
 * with a recorded location and drawn zone boundaries. Pins waiting for the office to place them, and
 * the 0,0 used for "not recorded", are left out so they cannot stretch the view across the world.
 * `null` when nothing is placed yet.
 */
export function networkExtent(data: ExtentData): LatLngBounds | null {
  const points: LatLng[] = [];
  for (const e of data.equipment) if (hasPlacedPosition(e)) points.push([e.lat, e.lng]);
  for (const c of data.cables) points.push(...c.coordinates);
  for (const c of data.customers) points.push([c.lat, c.lng]);
  for (const d of data.ducts ?? []) points.push(...d.coordinates);
  for (const z of data.zones ?? []) points.push(...z.boundaryCoords);
  return boundsOf(points.filter(usable));
}
