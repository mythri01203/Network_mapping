import {
  type CollectionName,
  type Equipment,
  hasRecordedLocation,
  type LatLng,
  type NetworkSnapshot,
  spanLine,
} from '@fibergis/shared';

import type { SelectedObject, SelectedObjectType } from '../../stores/uiStore';

/**
 * Phase 16: the map's selection set. A selected record is named by a key "collection:id". These
 * helpers are pure, so the map, the table and the tests agree. Nothing here is worked out from
 * distance: "connected" follows recorded links only, and an area holds what is drawn inside it.
 */

export type SelectionKey = string;

/** The collections people can select on the map or in the table. */
export const SELECTABLE_COLLECTIONS = [
  'equipment',
  'cables',
  'customers',
  'closures',
  'splitters',
  'ducts',
  'spans',
  'slackLoops',
  'faults',
  'zones',
  'onts',
  'buildings',
] as const satisfies readonly CollectionName[];
export type SelectableCollection = (typeof SELECTABLE_COLLECTIONS)[number];

export const COLLECTION_WORDS: Record<SelectableCollection, { one: string; many: string }> = {
  equipment: { one: 'item of equipment', many: 'equipment' },
  cables: { one: 'cable', many: 'cables' },
  customers: { one: 'customer', many: 'customers' },
  closures: { one: 'closure', many: 'closures' },
  splitters: { one: 'splitter', many: 'splitters' },
  ducts: { one: 'duct', many: 'ducts' },
  spans: { one: 'span', many: 'spans' },
  slackLoops: { one: 'slack loop', many: 'slack loops' },
  faults: { one: 'fault', many: 'faults' },
  zones: { one: 'zone', many: 'zones' },
  onts: { one: 'ONT', many: 'ONTs' },
  buildings: { one: 'building', many: 'buildings' },
};

export const isSelectable = (collection: string): collection is SelectableCollection => (SELECTABLE_COLLECTIONS as readonly string[]).includes(collection);

export const keyOf = (collection: CollectionName, id: string): SelectionKey => `${collection}:${id}`;

export function parseKey(key: SelectionKey): { collection: SelectableCollection; id: string } | null {
  const at = key.indexOf(':');
  if (at <= 0) return null;
  const collection = key.slice(0, at);
  return isSelectable(collection) ? { collection, id: key.slice(at + 1) } : null;
}

const TYPE_COLLECTION: Record<SelectedObjectType, SelectableCollection> = {
  equipment: 'equipment',
  cable: 'cables',
  customer: 'customers',
  closure: 'closures',
  fault: 'faults',
  span: 'spans',
  duct: 'ducts',
  slackLoop: 'slackLoops',
};

const COLLECTION_TYPE = Object.fromEntries(Object.entries(TYPE_COLLECTION).map(([t, c]) => [c, t])) as Partial<Record<SelectableCollection, SelectedObjectType>>;

export const keyForSelection = (selection: SelectedObject): SelectionKey => keyOf(TYPE_COLLECTION[selection.type], selection.data.id);

/** The inspector's selection for a record, when the inspector has a panel for that kind. */
export function selectionFor(collection: SelectableCollection, record: { id: string }): SelectedObject | null {
  const type = COLLECTION_TYPE[collection];
  return type ? ({ type, data: record } as SelectedObject) : null;
}

/** Fast lookups by id, built once per network version. */
export interface RecordIndex {
  get(collection: SelectableCollection, id: string): { id: string } | undefined;
  equipmentById: Map<string, Equipment>;
}

const indexCache = new WeakMap<object, Map<string, { id: string }>>();

const byIdOf = (list: readonly { id: string }[]): Map<string, { id: string }> => {
  let map = indexCache.get(list);
  if (!map) {
    map = new Map(list.map((r) => [r.id, r]));
    indexCache.set(list, map);
  }
  return map;
};

export function recordIndex(data: Pick<NetworkSnapshot, SelectableCollection>): RecordIndex {
  return {
    get: (collection, id) => byIdOf((data[collection] ?? []) as readonly { id: string }[]).get(id),
    equipmentById: byIdOf(data.equipment ?? []) as Map<string, Equipment>,
  };
}

/** The record a key names, or undefined when it no longer exists. */
export function recordForKey(data: Pick<NetworkSnapshot, SelectableCollection>, key: SelectionKey): { id: string } | undefined {
  const parsed = parseKey(key);
  return parsed ? recordIndex(data).get(parsed.collection, parsed.id) : undefined;
}

/** What a person calls a record in messages. */
export function recordLabel(record: { id: string } | undefined, fallback = ''): string {
  if (!record) return fallback;
  const r = record as { id: string; name?: string; title?: string; serialNumber?: string };
  return r.name || r.title || r.serialNumber || r.id;
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type Shape = { kind: 'point'; at: LatLng } | { kind: 'line'; points: LatLng[] } | { kind: 'ring'; points: LatLng[] };

const point = (lat: unknown, lng: unknown): Shape | null =>
  typeof lat === 'number' && typeof lng === 'number' && hasRecordedLocation({ lat, lng }) ? { kind: 'point', at: [lat, lng] } : null;

/**
 * Where a record is drawn. A splitter is drawn at its box; a span on the line between its two poles.
 * A record with no recorded place has no shape and is never "inside" an area.
 */
export function shapeOf(collection: SelectableCollection, record: { id: string }, index: RecordIndex): Shape | null {
  const r = record as Record<string, unknown>;
  switch (collection) {
    case 'equipment':
    case 'customers':
    case 'closures':
    case 'slackLoops':
    case 'buildings':
      return point(r.lat, r.lng);
    case 'faults': {
      const at = r.affectedLocation as { lat?: number; lng?: number } | undefined;
      return point(at?.lat, at?.lng);
    }
    case 'cables':
    case 'ducts': {
      const coords = r.coordinates as LatLng[] | undefined;
      return coords && coords.length >= 2 ? { kind: 'line', points: coords } : coords?.length === 1 ? point(coords[0][0], coords[0][1]) : null;
    }
    case 'spans': {
      const ends = [index.equipmentById.get(r.fromStructureId as string), index.equipmentById.get(r.toStructureId as string)];
      if (!ends[0] || !ends[1]) return null;
      const line = spanLine(r as never, ends as Equipment[]);
      return line && line.length >= 2 ? { kind: 'line', points: line } : null;
    }
    case 'zones': {
      const ring = r.boundaryCoords as LatLng[] | undefined;
      return ring && ring.length >= 3 ? { kind: 'ring', points: ring } : null;
    }
    case 'splitters': {
      const box = index.equipmentById.get(r.terminalBoxId as string);
      return box ? point(box.lat, box.lng) : null;
    }
    case 'onts':
      return null;
  }
}

/** The south-west and north-east corners around every point of the shapes. */
export function boundsOfShapes(shapes: readonly (Shape | null)[]): { south: number; west: number; north: number; east: number } | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const s of shapes) {
    if (!s) continue;
    for (const [lat, lng] of s.kind === 'point' ? [s.at] : s.points) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
  }
  return Number.isFinite(south) ? { south, west, north, east } : null;
}

/* ------------------------------------------------------------------ */
/* Areas                                                               */
/* ------------------------------------------------------------------ */

/** Ray casting on latitude and longitude: fine for the size of a town. */
export function pointInPolygon([lat, lng]: LatLng, polygon: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

const cross = (a: LatLng, b: LatLng, c: LatLng) => (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);

function segmentsCross(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The four corners of a box drawn between two points. */
export const boxPolygon = (a: LatLng, b: LatLng): LatLng[] => [
  [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
  [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
];

/** True when any part of the shape lies inside the area or crosses its edge. */
export function shapeTouchesPolygon(shape: Shape, polygon: readonly LatLng[]): boolean {
  if (polygon.length < 3) return false;
  if (shape.kind === 'point') return pointInPolygon(shape.at, polygon);
  const pts = shape.points;
  if (pts.some((p) => pointInPolygon(p, polygon))) return true;
  // A zone around the whole area also touches it.
  if (shape.kind === 'ring' && polygon.some((p) => pointInPolygon(p, pts))) return true;
  const n = shape.kind === 'ring' ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let j = 0; j < polygon.length; j++) if (segmentsCross(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return true;
  }
  return false;
}

const polygonBox = (polygon: readonly LatLng[]) => boundsOfShapes([{ kind: 'ring', points: polygon as LatLng[] }])!;

/** Keys of every record of these collections drawn (in part) inside the area. */
export function keysInArea(
  data: Pick<NetworkSnapshot, SelectableCollection>,
  polygon: readonly LatLng[],
  collections: readonly SelectableCollection[] = SELECTABLE_COLLECTIONS,
): SelectionKey[] {
  if (polygon.length < 3) return [];
  const index = recordIndex(data);
  const box = polygonBox(polygon);
  const keys: SelectionKey[] = [];
  for (const collection of collections) {
    for (const record of (data[collection] ?? []) as readonly { id: string }[]) {
      const shape = shapeOf(collection, record, index);
      if (!shape) continue;
      // A quick box test first, so a big network stays fast.
      if (shape.kind === 'point') {
        const [lat, lng] = shape.at;
        if (lat < box.south || lat > box.north || lng < box.west || lng > box.east) continue;
      } else {
        const b = boundsOfShapes([shape])!;
        if (b.north < box.south || b.south > box.north || b.east < box.west || b.west > box.east) continue;
      }
      if (shapeTouchesPolygon(shape, polygon)) keys.push(keyOf(collection, record.id));
    }
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* Connected by recorded links                                         */
/* ------------------------------------------------------------------ */

type Linkable = Pick<NetworkSnapshot, SelectableCollection | 'attachments'>;

/**
 * Records joined to these ones by a recorded link, one step out: a cable's two ends, the cables
 * ending at a box, a customer's box, splitter, drop cable and ONT, a span's poles and the cables
 * attached to it, a duct's cables, and so on. Only fields a person or a command recorded count;
 * nothing is joined because it is near. The keys given are not repeated in the answer.
 */
export function connectedKeys(data: Linkable, keys: Iterable<SelectionKey>): SelectionKey[] {
  const found = new Set<SelectionKey>();
  const start = new Set(keys);
  const add = (collection: SelectableCollection, id: string | undefined | null) => {
    if (id) found.add(keyOf(collection, id));
  };
  const ids = (collection: SelectableCollection) => {
    const out = new Set<string>();
    for (const key of start) {
      const p = parseKey(key);
      if (p?.collection === collection) out.add(p.id);
    }
    return out;
  };
  const eq = ids('equipment');
  const cb = ids('cables');
  const cu = ids('customers');
  const sp = ids('splitters');
  const cl = ids('closures');
  const sn = ids('spans');
  const du = ids('ducts');
  const sl = ids('slackLoops');
  const fa = ids('faults');
  const on = ids('onts');
  const bu = ids('buildings');

  for (const c of data.cables ?? []) {
    if (cb.has(c.id)) {
      add('equipment', c.startEquipmentId);
      add('equipment', c.endEquipmentId);
    }
    if ((c.startEquipmentId && eq.has(c.startEquipmentId)) || (c.endEquipmentId && eq.has(c.endEquipmentId))) add('cables', c.id);
  }
  for (const c of data.customers ?? []) {
    const linked = [c.dropCableId, c.feederCableId, c.distributionCableId].some((id) => id && cb.has(id)) || [c.terminalBoxId, c.oltId].some((id) => id && eq.has(id)) || (c.splitterId && sp.has(c.splitterId)) || (c.ontId && on.has(c.ontId)) || (c.buildingId && bu.has(c.buildingId));
    if (linked) add('customers', c.id);
    if (cu.has(c.id)) {
      add('equipment', c.terminalBoxId);
      add('equipment', c.oltId);
      add('splitters', c.splitterId);
      add('cables', c.dropCableId);
      add('onts', c.ontId);
      add('buildings', c.buildingId);
    }
  }
  for (const s of data.splitters ?? []) {
    const outs = s.outputPorts ?? [];
    const linked = eq.has(s.terminalBoxId) || (s.inputPort.connectedCableId && cb.has(s.inputPort.connectedCableId)) || outs.some((o) => (o.connectedDropCableId && cb.has(o.connectedDropCableId)) || (o.connectedCustomerId && cu.has(o.connectedCustomerId)) || (o.connectedEquipmentId && eq.has(o.connectedEquipmentId)));
    if (linked) add('splitters', s.id);
    if (sp.has(s.id)) {
      add('equipment', s.terminalBoxId);
      add('cables', s.inputPort.connectedCableId);
      add('splitters', s.inputPort.connectedSplitterId);
      for (const o of outs) {
        add('customers', o.connectedCustomerId);
        add('cables', o.connectedDropCableId);
        add('equipment', o.connectedEquipmentId);
      }
    }
  }
  for (const c of data.closures ?? []) {
    const cables = [c.cableAId, c.cableBId, ...(c.cableEntries ?? []).map((e) => e.cableId)];
    if ((c.equipmentId && eq.has(c.equipmentId)) || cables.some((id) => id && cb.has(id))) add('closures', c.id);
    if (cl.has(c.id)) {
      add('equipment', c.equipmentId);
      for (const id of cables) add('cables', id);
    }
  }
  const spanIds = new Set<string>();
  for (const s of data.spans ?? []) {
    if (eq.has(s.fromStructureId) || eq.has(s.toStructureId)) add('spans', s.id);
    if (sn.has(s.id)) {
      add('equipment', s.fromStructureId);
      add('equipment', s.toStructureId);
      spanIds.add(s.id);
    }
  }
  for (const a of data.attachments ?? []) {
    if ((a.spanId && spanIds.has(a.spanId)) || (a.structureId && eq.has(a.structureId))) add('cables', a.cableId);
    if (cb.has(a.cableId)) {
      add('spans', a.spanId);
      add('equipment', a.structureId);
    }
  }
  for (const d of data.ducts ?? []) {
    const inside = [...d.cableIds, ...d.subducts.flatMap((s) => [...s.cableIds, ...(s.microducts ?? []).flatMap((m) => m.cableIds)])];
    if ((d.fromStructureId && eq.has(d.fromStructureId)) || (d.toStructureId && eq.has(d.toStructureId)) || inside.some((id) => cb.has(id))) add('ducts', d.id);
    if (du.has(d.id)) {
      add('equipment', d.fromStructureId);
      add('equipment', d.toStructureId);
      for (const id of inside) add('cables', id);
    }
  }
  for (const s of data.slackLoops ?? []) {
    if (cb.has(s.cableId) || (s.structureId && eq.has(s.structureId))) add('slackLoops', s.id);
    if (sl.has(s.id)) {
      add('cables', s.cableId);
      add('equipment', s.structureId);
    }
  }
  for (const f of data.faults ?? []) {
    if (fa.has(f.id)) {
      add('equipment', f.affectedEquipmentId);
      add('cables', f.affectedCableId);
      for (const id of f.affectedCustomerIds) add('customers', id);
    }
  }
  for (const o of data.onts ?? []) {
    if (on.has(o.id)) {
      add('equipment', o.oltId);
      add('splitters', o.splitterId);
      add('cables', o.dropCableId);
    }
  }
  for (const b of data.buildings ?? []) {
    if ((b.entryEquipmentId && eq.has(b.entryEquipmentId)) || (b.riserCableId && cb.has(b.riserCableId))) add('buildings', b.id);
    if (bu.has(b.id)) {
      add('equipment', b.entryEquipmentId);
      add('cables', b.riserCableId);
    }
  }
  // Only records that exist; a link naming a missing record is a gap the map check reports.
  const index = recordIndex(data);
  return [...found].filter((k) => {
    if (start.has(k)) return false;
    const p = parseKey(k);
    return !!p && !!index.get(p.collection, p.id);
  });
}

/** Every record of the same kinds as the selection that is not selected now. */
export function invertKeys(data: Pick<NetworkSnapshot, SelectableCollection>, keys: ReadonlySet<SelectionKey>, collections?: readonly SelectableCollection[]): SelectionKey[] {
  const kinds = collections ?? [...new Set([...keys].map((k) => parseKey(k)?.collection).filter((c): c is SelectableCollection => !!c))];
  const out: SelectionKey[] = [];
  for (const collection of kinds) {
    for (const r of (data[collection] ?? []) as readonly { id: string }[]) {
      const k = keyOf(collection, r.id);
      if (!keys.has(k)) out.push(k);
    }
  }
  return out;
}

/** How many of each kind, for "12 cables, 3 poles". */
export function countByCollection(keys: Iterable<SelectionKey>): Map<SelectableCollection, number> {
  const counts = new Map<SelectableCollection, number>();
  for (const k of keys) {
    const p = parseKey(k);
    if (p) counts.set(p.collection, (counts.get(p.collection) ?? 0) + 1);
  }
  return counts;
}

export function describeCounts(counts: Map<SelectableCollection, number>): string {
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n.toLocaleString()} ${n === 1 ? COLLECTION_WORDS[c].one : COLLECTION_WORDS[c].many}`);
  return parts.length ? parts.join(', ') : 'Nothing selected';
}

/* ------------------------------------------------------------------ */
/* Right-click: what is under the pointer                              */
/* ------------------------------------------------------------------ */

export interface ScreenPoint {
  x: number;
  y: number;
}

const distToSegment = (p: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * The record drawn nearest the pointer, within `pointPx` of a point or `linePx` of a line. Points
 * win over lines (a pin sits on its cable). `area` limits the work to records near the pointer.
 */
export function hitTest(
  data: Pick<NetworkSnapshot, SelectableCollection>,
  at: ScreenPoint,
  toScreen: (p: LatLng) => ScreenPoint,
  near: { south: number; west: number; north: number; east: number },
  collections: readonly SelectableCollection[] = SELECTABLE_COLLECTIONS,
  { pointPx = 18, linePx = 9 } = {},
): SelectionKey | null {
  const index = recordIndex(data);
  let bestPoint: { key: SelectionKey; d: number } | null = null;
  let bestLine: { key: SelectionKey; d: number } | null = null;
  const inNear = ([lat, lng]: LatLng) => lat >= near.south && lat <= near.north && lng >= near.west && lng <= near.east;
  for (const collection of collections) {
    for (const record of (data[collection] ?? []) as readonly { id: string }[]) {
      const shape = shapeOf(collection, record, index);
      if (!shape) continue;
      if (shape.kind === 'point') {
        if (!inNear(shape.at)) continue;
        const s = toScreen(shape.at);
        const d = Math.hypot(s.x - at.x, s.y - at.y);
        if (d <= pointPx && (!bestPoint || d < bestPoint.d)) bestPoint = { key: keyOf(collection, record.id), d };
        continue;
      }
      if (shape.kind === 'ring') continue; // Zones are areas: right-click inside one is not "on" it.
      const b = boundsOfShapes([shape])!;
      if (b.north < near.south || b.south > near.north || b.east < near.west || b.west > near.east) continue;
      const pts = shape.points.map(toScreen);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(at, pts[i], pts[i + 1]);
        if (d <= linePx && (!bestLine || d < bestLine.d)) bestLine = { key: keyOf(collection, record.id), d };
      }
    }
  }
  return bestPoint?.key ?? bestLine?.key ?? null;
}
