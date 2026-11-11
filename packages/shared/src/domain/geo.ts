import type { LatLng } from '../model/types';

const EARTH_RADIUS_M = 6371e3;

/** Great-circle length of a polyline of [lat, lng] points, in metres. */
export function polylineLengthMeters(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lon1] = points[i];
    const [lat2, lon2] = points[i + 1];
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = ((lat2 - lat1) * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    total += EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

/**
 * Area of a closed ring of [lat, lng] points on the sphere, in square metres (the ring closes itself;
 * fewer than 3 points have no area). Spherical excess per edge, accurate for network-sized areas.
 */
export function polygonAreaSqMeters(points: readonly LatLng[]): number {
  if (points.length < 3) return 0;
  const rad = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lon1] = points[i];
    const [lat2, lon2] = points[(i + 1) % points.length];
    sum += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export interface LatLngBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The box around some points, or null when there are none. */
export function boundsOf(points: readonly LatLng[]): LatLngBounds | null {
  if (points.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/** Ground metres one screen pixel covers at a latitude and Web Mercator zoom level. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 8);
}
