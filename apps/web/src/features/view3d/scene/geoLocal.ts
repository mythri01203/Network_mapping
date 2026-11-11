import type { LocalPoint } from './types';

/** Mean Earth radius (IUGG), metres. */
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface GeoOrigin {
  lat: number;
  lng: number;
}

export interface Projection {
  origin: GeoOrigin;
  toLocal: (lat: number, lng: number) => LocalPoint;
  toGeo: (point: LocalPoint) => GeoOrigin;
}

/**
 * A local tangent-plane projection around `origin`: x = metres east, z = metres south.
 * Accurate to well under 1% inside a few kilometres, which is the size of one access network.
 */
export function makeProjection(origin: GeoOrigin): Projection {
  const cos = Math.cos(origin.lat * RAD);
  const k = RAD * EARTH_RADIUS_M;
  return {
    origin,
    toLocal: (lat, lng) => ({ x: (lng - origin.lng) * k * cos, z: -(lat - origin.lat) * k }),
    toGeo: ({ x, z }) => ({ lat: origin.lat - z / k, lng: origin.lng + x / (k * (cos || 1e-9)) }),
  };
}

/**
 * The origin for a scene: the point the person picked, else the first preferred point (an OLT),
 * else the middle of all points. `{0, 0}` only when there is nothing at all.
 */
export function pickOrigin(
  points: readonly (readonly [number, number])[],
  preferred?: readonly [number, number] | null,
): GeoOrigin {
  if (preferred) return { lat: preferred[0], lng: preferred[1] };
  if (points.length === 0) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  for (const [a, b] of points) {
    lat += a;
    lng += b;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

export const distance = (a: LocalPoint, b: LocalPoint): number => Math.hypot(a.x - b.x, a.z - b.z);

export function polylineLength(points: readonly LocalPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

/** Deterministic 0..1 from a string (FNV-1a), so a house always gets the same colours. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}
