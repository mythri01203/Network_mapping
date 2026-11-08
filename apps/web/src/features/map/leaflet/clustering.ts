import Supercluster from 'supercluster';

/**
 * Phase 9: keeps a map with tens of thousands of pins usable. Only pins inside the visible area
 * (plus a margin) are drawn, and when too many would be drawn at once, nearby pins are drawn as
 * one round "group" marker with the number of pins inside. A group never hides that pins exist:
 * it says how many, and tapping it zooms in until the pins show one by one.
 */

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
}

/** West, south, east, north in degrees. */
export type Bbox = [number, number, number, number];

export interface PointGroup {
  key: string;
  lat: number;
  lng: number;
  count: number;
  /** The zoom at which this group splits into smaller groups or single pins. */
  expansionZoom: number;
}

export interface ViewPoints {
  /** Ids drawn as their own pin. */
  singles: string[];
  groups: PointGroup[];
}

/** From this zoom pins are always drawn one by one (a street is in view). */
export const CLUSTER_MAX_ZOOM = 16;
/** Fewer pins than this in view are drawn one by one at any zoom. */
export const CLUSTER_MIN_POINTS = 300;

export interface PointIndex {
  points: readonly MapPoint[];
  cluster: Supercluster<{ id: string }, Record<string, never>>;
}

export function buildPointIndex(points: readonly MapPoint[]): PointIndex {
  const cluster = new Supercluster<{ id: string }, Record<string, never>>({ radius: 60, maxZoom: CLUSTER_MAX_ZOOM - 1, minPoints: 3 });
  cluster.load(
    points.map((p) => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
  );
  return { points, cluster };
}

const inBox = (p: MapPoint, [w, s, e, n]: Bbox) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e;

/**
 * What to draw for this view. `keep` (the selected, traced or moving pin) is always drawn on its
 * own, even inside a group, so what a person is working on never disappears.
 */
export function pointsInView(index: PointIndex, bbox: Bbox, zoom: number, keep: ReadonlySet<string> = new Set()): ViewPoints {
  const inside = index.points.filter((p) => inBox(p, bbox));
  if (zoom >= CLUSTER_MAX_ZOOM || inside.length < CLUSTER_MIN_POINTS) {
    const singles = inside.map((p) => p.id);
    for (const id of keep) if (!singles.includes(id) && index.points.some((p) => p.id === id)) singles.push(id);
    return { singles, groups: [] };
  }
  const singles: string[] = [];
  const groups: PointGroup[] = [];
  for (const feature of index.cluster.getClusters(bbox, Math.floor(zoom))) {
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; id?: string };
    if (props.cluster && props.cluster_id !== undefined) {
      groups.push({
        key: `g${props.cluster_id}`,
        lat,
        lng,
        count: props.point_count ?? 0,
        expansionZoom: Math.min(index.cluster.getClusterExpansionZoom(props.cluster_id), CLUSTER_MAX_ZOOM),
      });
    } else if (props.id) {
      singles.push(props.id);
    }
  }
  for (const id of keep) if (!singles.includes(id) && index.points.some((p) => p.id === id)) singles.push(id);
  return { singles, groups };
}

/** True when a cable's route passes through (or its bounding box touches) the view. */
export function lineTouchesBox(coordinates: readonly (readonly [number, number])[], [w, s, e, n]: Bbox): boolean {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of coordinates) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return maxLat >= s && minLat <= n && maxLng >= w && minLng <= e;
}

/** A view box grown by `pad` of its size on each side, so a small pan needs no redraw. */
export function padBox([w, s, e, n]: Bbox, pad = 0.5): Bbox {
  const dx = (e - w) * pad;
  const dy = (n - s) * pad;
  return [w - dx, s - dy, e + dx, n + dy];
}
