import type { CollectionName } from '../model/collections';
import type { Cable, LatLng } from '../model/types';
import { findDuplicateRoutes } from './cableRouteEdit';
import type { NetworkData } from './command';
import { hasRecordedLocation } from './defaults';
import { type CheckLimits, checkLimitsFrom } from './validationSettings';

/**
 * Network mapping Phase 15: geometry rules of the map check. Every rule only warns: a crossing, a
 * double point or a cable end far from its box may be real, so nothing is changed, moved, merged or
 * linked by them. Each limit is an operator setting with its source (`validationSettings.ts`).
 */

/** One problem one check run found, before it is stored as a finding. */
export interface FoundProblem {
  /** Rule and record ids: the same problem found again has the same key. */
  key: string;
  rule: string;
  severity: 'error' | 'warning' | 'note';
  source: 'map_check' | 'geometry';
  targetCollection?: CollectionName;
  targetId: string;
  relatedIds?: string[];
  /** Plain words. Customers by id only. */
  message: string;
  /** What to do about it. */
  fix: string;
  lat?: number;
  lng?: number;
}

export const GEOMETRY_RULES = ['route-self-intersects', 'route-extra-point', 'cable-end-gap', 'asset-outside-zones', 'route-duplicate'] as const;
export type GeometryRule = (typeof GEOMETRY_RULES)[number];

export const GEOMETRY_RULE_LABELS: Record<GeometryRule, string> = {
  'route-self-intersects': 'A line crosses itself',
  'route-extra-point': 'Two points of a line almost on top of each other',
  'cable-end-gap': 'A cable end is far from the item it connects to',
  'asset-outside-zones': 'An item outside every drawn zone',
  'route-duplicate': 'Two cables with the same ends along the same line',
};

export const GEOMETRY_FIX_TEXT: Record<GeometryRule, string> = {
  'route-self-intersects': 'Open the line, tap Edit route, and move or remove the points that make it cross. If the cable really loops (a slack coil), leave it and mark this "fine as it is".',
  'route-extra-point': 'Open the line, tap Edit route, and remove the extra point. Nothing else changes.',
  'cable-end-gap': 'Check on the map which is wrong: move the end of the line to the box, or change the box the cable says it connects to.',
  'asset-outside-zones': 'Check the item is in the right place. If it is, draw or widen the zone boundary to include it.',
  'route-duplicate': 'Check whether this is one cable drawn twice. If it is, delete the copy; if it is a second real cable (a spare or a ring), mark this "fine as it is".',
};

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Metres between two points (haversine). */
export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points on a flat local projection in metres, around the first point. Fine for a town. */
const project = (points: readonly LatLng[]): [number, number][] => {
  if (points.length === 0) return [];
  const [lat0, lng0] = points[0];
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  const cos0 = Math.cos(toRad(lat0));
  return points.map(([lat, lng]) => [(lng - lng0) * k * cos0, (lat - lat0) * k]);
};

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Where two segments cross (not just touch at a shared end), as a share along the first, or null. */
function segmentsCross(p1: [number, number], p2: [number, number], q1: [number, number], q2: [number, number]): number | null {
  const rx = p2[0] - p1[0];
  const ry = p2[1] - p1[1];
  const sx = q2[0] - q1[0];
  const sy = q2[1] - q1[1];
  const denom = cross(rx, ry, sx, sy);
  if (Math.abs(denom) < 1e-9) return null; // parallel or overlapping: not a crossing
  const qpx = q1[0] - p1[0];
  const qpy = q1[1] - p1[1];
  const t = cross(qpx, qpy, sx, sy) / denom;
  const u = cross(qpx, qpy, rx, ry) / denom;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps ? t : null;
}

/** The first place a line crosses itself, or null. Lines over this many points are not checked. */
export function selfIntersection(points: readonly LatLng[], maxPoints = 2000): { segment: number; other: number; at: LatLng } | null {
  if (points.length < 4 || points.length > maxPoints) return null;
  const xy = project(points);
  for (let i = 0; i < xy.length - 1; i += 1) {
    for (let j = i + 2; j < xy.length - 1; j += 1) {
      // A closed ring touches its own start: that is not a crossing.
      if (i === 0 && j === xy.length - 2 && metersBetween(points[0], points[points.length - 1]) < 0.01) continue;
      const t = segmentsCross(xy[i], xy[i + 1], xy[j], xy[j + 1]);
      if (t === null) continue;
      const a = points[i];
      const b = points[i + 1];
      return { segment: i, other: j, at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
    }
  }
  return null;
}

/** Point positions (0-based) that sit closer than `meters` to the point before them. */
export function closePoints(points: readonly LatLng[], meters: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i += 1) if (metersBetween(points[i - 1], points[i]) < meters) out.push(i);
  return out;
}

/** True when the point is inside the ring (ray casting). */
export function pointInRing(point: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  const [y, x] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const isPair = (p: unknown): p is LatLng => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

type GeometryData = Pick<NetworkData, 'equipment' | 'cables' | 'customers' | 'zones'> & Partial<Pick<NetworkData, 'ducts'>>;

/** The geometry rules over a whole network, with the operator's limits. */
export function findGeometryProblems(data: GeometryData, limits: CheckLimits = checkLimitsFrom()): FoundProblem[] {
  const out: FoundProblem[] = [];
  const { validation, osp } = limits;
  const equipmentById = new Map(data.equipment.map((e) => [e.id, e]));
  const customerById = new Map(data.customers.map((c) => [c.id, c]));

  const lines: { collection: CollectionName; id: string; name: string; points: LatLng[]; word: string }[] = [
    ...data.cables.map((c) => ({ collection: 'cables' as const, id: c.id, name: c.name, points: (c.coordinates ?? []).filter(isPair), word: 'Cable' })),
    ...(data.ducts ?? []).map((d) => ({ collection: 'ducts' as const, id: d.id, name: d.name ?? d.id, points: (d.coordinates ?? []).filter(isPair), word: 'Duct' })),
  ];

  for (const line of lines) {
    const crossing = selfIntersection(line.points);
    if (crossing) {
      out.push({
        key: `geometry:route-self-intersects:${line.id}`,
        rule: 'route-self-intersects',
        severity: 'warning',
        source: 'geometry',
        targetCollection: line.collection,
        targetId: line.id,
        message: `${line.word} "${line.name}": its line crosses itself between points ${crossing.segment + 1}–${crossing.segment + 2} and ${crossing.other + 1}–${crossing.other + 2}.`,
        fix: GEOMETRY_FIX_TEXT['route-self-intersects'],
        lat: crossing.at[0],
        lng: crossing.at[1],
      });
    }
    const close = closePoints(line.points, validation.minVertexSpacingMeters);
    if (close.length > 0) {
      const at = line.points[close[0]];
      out.push({
        key: `geometry:route-extra-point:${line.id}`,
        rule: 'route-extra-point',
        severity: 'note',
        source: 'geometry',
        targetCollection: line.collection,
        targetId: line.id,
        message: `${line.word} "${line.name}": ${close.length} point(s) sit closer than ${validation.minVertexSpacingMeters} m to the point before (first at point ${close[0] + 1}).`,
        fix: GEOMETRY_FIX_TEXT['route-extra-point'],
        lat: at[0],
        lng: at[1],
      });
    }
  }

  for (const cable of data.cables) {
    const coords = (cable.coordinates ?? []).filter(isPair);
    if (coords.length < 2) continue;
    for (const side of ['start', 'end'] as const) {
      const ref = side === 'start' ? cable.startEquipmentId : cable.endEquipmentId;
      if (!ref) continue;
      const eq = equipmentById.get(ref);
      const cu = eq ? undefined : customerById.get(ref);
      const target = eq ?? cu;
      if (!target || !hasRecordedLocation(target)) continue;
      const point = side === 'start' ? coords[0] : coords[coords.length - 1];
      const gap = metersBetween(point, [target.lat, target.lng]);
      if (gap <= validation.cableEndGapMeters) continue;
      // A customer is named by id only, and their house position is never stored in a finding.
      const what = eq ? `"${eq.name}"` : `customer ${ref}`;
      out.push({
        key: `geometry:cable-end-gap:${cable.id}:${side}`,
        rule: 'cable-end-gap',
        severity: 'warning',
        source: 'geometry',
        targetCollection: 'cables',
        targetId: cable.id,
        relatedIds: [ref],
        message: `Cable "${cable.name}": the ${side === 'start' ? 'From' : 'To'} end of its line is ${Math.round(gap)} m from ${what}, which it says it connects to (limit ${validation.cableEndGapMeters} m).`,
        fix: GEOMETRY_FIX_TEXT['cable-end-gap'],
        lat: point[0],
        lng: point[1],
      });
    }
  }

  const rings = data.zones.map((z) => (z.boundaryCoords ?? []).filter(isPair)).filter((r) => r.length >= 3);
  // Only when zones have boundaries: with none drawn, "outside" means nothing.
  if (rings.length > 0) {
    for (const eq of data.equipment) {
      if (!hasRecordedLocation(eq)) continue;
      const point: LatLng = [eq.lat, eq.lng];
      if (rings.some((ring) => pointInRing(point, ring))) continue;
      out.push({
        key: `geometry:asset-outside-zones:${eq.id}`,
        rule: 'asset-outside-zones',
        severity: 'note',
        source: 'geometry',
        targetCollection: 'equipment',
        targetId: eq.id,
        message: `"${eq.name}" (${eq.type}) is outside every drawn zone boundary.`,
        fix: GEOMETRY_FIX_TEXT['asset-outside-zones'],
        lat: eq.lat,
        lng: eq.lng,
      });
    }
  }

  const seenPairs = new Set<string>();
  const comparable = data.cables.filter((c) => (c.coordinates ?? []).length >= 2 && c.startEquipmentId && c.endEquipmentId);
  const byEnds = new Map<string, Cable[]>();
  for (const c of comparable) {
    const ends = [c.startEquipmentId!, c.endEquipmentId!].sort().join('|');
    const list = byEnds.get(ends);
    if (list) list.push(c);
    else byEnds.set(ends, [c]);
  }
  for (const group of byEnds.values()) {
    if (group.length < 2) continue;
    for (const cable of group) {
      for (const twin of findDuplicateRoutes(group, cable, osp)) {
        const pair = [cable.id, twin.cable.id].sort();
        const pairKey = pair.join('|');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const mid = cable.coordinates[Math.floor(cable.coordinates.length / 2)];
        out.push({
          key: `geometry:route-duplicate:${pairKey}`,
          rule: 'route-duplicate',
          severity: 'warning',
          source: 'geometry',
          targetCollection: 'cables',
          targetId: pair[0],
          relatedIds: [pair[1]],
          message: `Cables "${cable.name}" and "${twin.cable.name}" have the same two ends, and ${Math.round(twin.overlapRatio * 100)}% of the shorter line runs within ${osp.duplicateRouteCorridorMeters} m of the other. It may be one cable mapped twice.`,
          fix: GEOMETRY_FIX_TEXT['route-duplicate'],
          ...(mid ? { lat: mid[0], lng: mid[1] } : {}),
        });
      }
    }
  }
  return out;
}
