import type { CollectionName } from '@fibergis/shared';

/**
 * Phase 24: where a stored record is on the map, for the spatial index and the map-area queries.
 * Read from the record's own fields, whatever its collection, so a collection added later with
 * `lat`/`lng` (or a `coordinates` line) is indexed without a change here:
 *
 * - a point: top-level numeric `lat` and `lng`, or a top-level object holding them (`affectedLocation`);
 * - a line: `coordinates` or `routePoints` (`[lat, lng]` pairs), or `points` (`[time, lat, lng, accuracy]`, trips);
 * - an area: `boundaryCoords` or `footprint` (`[lat, lng]` pairs, a closed ring).
 *
 * A span has no position of its own: it is the line between its two structures (and its bends),
 * so its ends are looked up. Values outside the earth's range are ignored, never guessed.
 */

export type LatLngPair = [number, number];

export interface Shape {
  kind: 'point' | 'line' | 'ring';
  points: LatLngPair[];
}

/** `[south, west, north, east]`, in degrees. */
export type Box = readonly [number, number, number, number];

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

const LINE_KEYS = ['coordinates', 'routePoints'] as const;
const RING_KEYS = ['boundaryCoords', 'footprint'] as const;

const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

const pairOf = (lat: unknown, lng: unknown): LatLngPair | undefined => (isLat(lat) && isLng(lng) ? [lat, lng] : undefined);

const pairsOf = (value: unknown, latIndex = 0): LatLngPair[] => {
  if (!Array.isArray(value)) return [];
  const pairs: LatLngPair[] = [];
  for (const item of value) {
    if (!Array.isArray(item)) continue;
    const pair = pairOf(item[latIndex], item[latIndex + 1]);
    if (pair) pairs.push(pair);
  }
  return pairs;
};

/** Finds a structure's position, for a span's ends. */
export type PointLookup = (id: string) => LatLngPair | undefined;

/** The point of a record with top-level `lat`/`lng` (equipment, poles, customers and the like). */
export const ownPoint = (record: Record<string, unknown>): LatLngPair | undefined => pairOf(record.lat, record.lng);

/** Every shape a record has on the map; empty when it has no position. */
export function shapesOf(collection: CollectionName, record: Record<string, unknown>, pointOf?: PointLookup): Shape[] {
  const shapes: Shape[] = [];
  const own = ownPoint(record);
  if (own) shapes.push({ kind: 'point', points: [own] });
  for (const [key, value] of Object.entries(record)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const nested = value as Record<string, unknown>;
    const point = pairOf(nested.lat, nested.lng);
    if (point && key !== 'customAttributes') shapes.push({ kind: 'point', points: [point] });
  }
  for (const key of LINE_KEYS) {
    if (collection === 'spans' && key === 'routePoints') continue;
    const line = pairsOf(record[key]);
    if (line.length > 0) shapes.push({ kind: line.length === 1 ? 'point' : 'line', points: line });
  }
  for (const key of RING_KEYS) {
    const ring = pairsOf(record[key]);
    if (ring.length > 0) shapes.push({ kind: ring.length < 3 ? 'line' : 'ring', points: ring });
  }
  if (collection === 'agentTrips') {
    const track = pairsOf(record.points, 1);
    if (track.length > 0) shapes.push({ kind: track.length === 1 ? 'point' : 'line', points: track });
  }
  if (collection === 'spans' && pointOf) {
    const from = typeof record.fromStructureId === 'string' ? pointOf(record.fromStructureId) : undefined;
    const to = typeof record.toStructureId === 'string' ? pointOf(record.toStructureId) : undefined;
    const line = [...(from ? [from] : []), ...pairsOf(record.routePoints), ...(to ? [to] : [])];
    if (line.length > 0) shapes.push({ kind: line.length === 1 ? 'point' : 'line', points: line });
  }
  return shapes;
}

export function boundsOfShapes(shapes: readonly Shape[]): Bounds | null {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const shape of shapes) {
    for (const [lat, lng] of shape.points) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return minLat === Infinity ? null : { minLat, minLng, maxLat, maxLng };
}

const inBox = ([lat, lng]: LatLngPair, [south, west, north, east]: Box) => lat >= south && lat <= north && lng >= west && lng <= east;

/** Whether the segment a-b crosses or touches the box (Liang-Barsky clipping, lng as x and lat as y). */
function segmentTouchesBox(a: LatLngPair, b: LatLngPair, [south, west, north, east]: Box): boolean {
  const [y0, x0] = a;
  const dy = b[0] - y0;
  const dx = b[1] - x0;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, x0 - west],
    [dx, east - x0],
    [-dy, y0 - south],
    [dy, north - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

function pointInRing([lat, lng]: LatLngPair, ring: readonly LatLngPair[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a shape touches the box: a point in it, a line crossing it, an area overlapping it. */
export function shapeTouchesBox(shape: Shape, box: Box): boolean {
  const { points } = shape;
  if (points.some((p) => inBox(p, box))) return true;
  if (shape.kind === 'point') return false;
  const closed = shape.kind === 'ring' ? [...points, points[0]] : points;
  for (let i = 1; i < closed.length; i += 1) if (segmentTouchesBox(closed[i - 1], closed[i], box)) return true;
  // An area larger than the box, around it.
  return shape.kind === 'ring' && pointInRing([box[0], box[1]], points);
}

/** Reads `south,west,north,east`. Undefined when it is not four numbers in range with south <= north and west <= east. */
export function parseBox(text: string | undefined): Box | undefined {
  if (!text) return undefined;
  const parts = text.split(',').map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => p === '' || !Number.isFinite(Number(p)))) return undefined;
  const [south, west, north, east] = parts.map(Number);
  if (!isLat(south) || !isLat(north) || !isLng(west) || !isLng(east) || south > north || west > east) return undefined;
  return [south, west, north, east];
}
