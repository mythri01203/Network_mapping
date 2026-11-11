import type { CollectionName, NetworkSnapshot } from '@fibergis/shared';

import type { PendingIds } from './changeTracking';
import { sameValue } from './changeTracking';

/**
 * Phase 24b: loading a big network by map area. The collections that hold most of a big network's
 * records, and have a place on the map, are loaded only for the map areas a person has looked at
 * (`GET /network/area`); every other collection is loaded in full (`GET /network?except=`). Changes
 * made elsewhere still arrive through `GET /changes?since=`, for every record.
 *
 * What this device holds is then part of the network. A pan only adds records; a full reload (start,
 * back online, discard) keeps the area in view and the records with unsent edits. The screens say
 * "part loaded" (`AreaLoadNotice`), records the loaded ones point to are loaded too, and the search
 * also asks the server, so a record that is only not loaded is never shown as not existing.
 */
export const AREA_COLLECTIONS = ['equipment', 'cables', 'customers', 'spans', 'ducts', 'slackLoops', 'buildings'] as const satisfies readonly CollectionName[];

export type AreaCollection = (typeof AREA_COLLECTIONS)[number];

/** From this many records in those collections, the network is loaded by map area (see the test plan for why). */
export const AREA_MODE_MIN_RECORDS = 30_000;

/**
 * The widest view loaded at once: from further out, only the middle of the view, as wide as at this
 * zoom, is loaded (and the screen says so). A wider box would carry tens of thousands of records.
 */
export const AREA_WIDEST_ZOOM = 16;

/** South, west, north, east in degrees (the server's order). */
export type AreaBox = readonly [number, number, number, number];

const isAreaCollection = (name: string): name is AreaCollection => (AREA_COLLECTIONS as readonly string[]).includes(name);

/** Records of the area collections on the server, from `GET /health` counts. */
export function areaRecordCount(counts: Partial<Record<CollectionName, number>> | undefined): number {
  return AREA_COLLECTIONS.reduce((total, name) => total + (counts?.[name] ?? 0), 0);
}

/** Where this device chose to load: `auto` (by area when the network is big) or `whole` (always the whole network). */
export type LoadPreference = 'auto' | 'whole';
const PREFERENCE_KEY = 'fiber_gis_load_preference';

export function readLoadPreference(): LoadPreference {
  try {
    return globalThis.localStorage?.getItem(PREFERENCE_KEY) === 'whole' ? 'whole' : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeLoadPreference(preference: LoadPreference): void {
  try {
    if (preference === 'whole') globalThis.localStorage?.setItem(PREFERENCE_KEY, 'whole');
    else globalThis.localStorage?.removeItem(PREFERENCE_KEY);
  } catch {
    // Not stored: this device asks again after a reload. Nothing else depends on it.
  }
}

/**
 * The map area in view (from the stored map centre and zoom, and the screen size, which the map is
 * never larger than), grown by a quarter of its size on each side so a small pan needs no new load.
 */
export function viewBox(view: { lat: number; lng: number; zoom: number }, size: { width: number; height: number }, pad = 0.25): AreaBox {
  // Web Mercator: 256 px tiles, so a degree of longitude is 256 * 2^zoom / 360 px.
  const lngPerPx = 360 / (256 * 2 ** view.zoom);
  const latPerPx = lngPerPx * Math.cos((Math.min(85, Math.abs(view.lat)) * Math.PI) / 180);
  const halfW = (size.width / 2) * lngPerPx * (1 + 2 * pad);
  const halfH = (size.height / 2) * latPerPx * (1 + 2 * pad);
  return [Math.max(-90, view.lat - halfH), Math.max(-180, view.lng - halfW), Math.min(90, view.lat + halfH), Math.min(180, view.lng + halfW)];
}

/** Whether `inner` lies inside one of the boxes already loaded. */
export function isCovered(loaded: readonly AreaBox[], inner: AreaBox): boolean {
  return loaded.some(([s, w, n, e]) => inner[0] >= s && inner[1] >= w && inner[2] <= n && inner[3] <= e);
}

/**
 * Adds or replaces the loaded records, never takes one away (a record not in the answer may simply
 * be outside the box). A record with unsent edits on this device keeps its local version, as in a
 * whole load. Unchanged records and collections keep their object identity.
 */
export function mergeLoaded(local: NetworkSnapshot, loaded: Partial<NetworkSnapshot>, pending: PendingIds): Partial<NetworkSnapshot> {
  const changed: Record<string, { id: string }[]> = {};
  for (const [name, records] of Object.entries(loaded) as [CollectionName, { id: string }[]][]) {
    if (!records?.length || !(name in local)) continue;
    const mine = new Set(pending[name] ?? []);
    const list = local[name] as unknown as { id: string }[];
    const at = new Map(list.map((r, i) => [r.id, i]));
    let next: { id: string }[] | null = null;
    for (const record of records) {
      if (mine.has(record.id)) continue;
      const i = at.get(record.id);
      if (i !== undefined && sameValue(list[i], record)) continue;
      next ??= [...list];
      if (i === undefined) {
        at.set(record.id, next.length);
        next.push(record);
      } else next[i] = record;
    }
    if (next) changed[name] = next;
  }
  return changed as Partial<NetworkSnapshot>;
}

/** Field names that hold the id of another record: `...Id` and `...Ids`, at any depth (ports, outputs). */
const isRefKey = (key: string) => key !== 'id' && /(Id|Ids)$/.test(key);

function collectRefs(value: unknown, into: Set<string>, depth: number): void {
  if (depth > 4 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (isRefKey(key)) {
      if (typeof item === 'string' && item) into.add(item);
      else if (Array.isArray(item)) for (const id of item) if (typeof id === 'string' && id) into.add(id);
    } else if (item && typeof item === 'object') collectRefs(item, into, depth + 1);
  }
}

/**
 * Ids that the loaded records point to (a cable's end, a customer's box, a span's poles, an OLT
 * port's feeder cable) and that this device does not hold in any area collection, so they can be
 * loaded too and a link is never shown as pointing at nothing. One step only; ids of the collections
 * loaded in full are left out (they are all here already, or do not exist).
 */
export function missingReferences(loaded: Partial<NetworkSnapshot>, snapshot: NetworkSnapshot): string[] {
  const refs = new Set<string>();
  for (const [name, records] of Object.entries(loaded)) if (isAreaCollection(name)) for (const record of (records ?? []) as unknown[]) collectRefs(record, refs, 0);
  const held = new Set<string>();
  for (const name of AREA_COLLECTIONS) for (const record of snapshot[name] as unknown as { id: string }[]) held.add(record.id);
  // An id of a fully loaded collection (a splitter, a catalogue model, a site) is never asked for.
  for (const [name, records] of Object.entries(snapshot)) {
    if (isAreaCollection(name) || !Array.isArray(records)) continue;
    for (const record of records as { id?: string }[]) if (record?.id) held.add(record.id);
  }
  return [...refs].filter((id) => !held.has(id));
}
