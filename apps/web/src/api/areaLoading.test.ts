import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChangeSet, COLLECTION_NAMES, type CollectionName, type HealthResponse, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { storageKey } from '../lib/storage';
import { useAreaLoadStore } from '../stores/areaLoadStore';
import { useMapStore } from '../stores/mapStore';
import type * as NetworkStore from '../stores/networkStore';
import { SYNC_META_STORAGE_KEY, useNetworkStore } from '../stores/networkStore';
import { useSyncStore } from '../stores/syncStore';
import { AREA_COLLECTIONS, type AreaBox, isCovered, mergeLoaded, missingReferences, viewBox, writeLoadPreference } from './areaLoading';
import { type ApiClient, ApiError, ApiUnavailableError } from './client';
import { createSyncEngine, type SyncEngine } from './syncEngine';

vi.mock('../stores/networkStore', async (importOriginal) => ({
  ...(await importOriginal<typeof NetworkStore>()),
  wasLoadedFromCache: vi.fn(() => false),
}));

/**
 * Phase 24b: a big network loaded by map area. Records outside the loaded area are never shown as
 * gone: they are simply not here yet, the area store says "part loaded", records the loaded ones point
 * to are loaded too, changes made anywhere still arrive, and nothing outside is taken away by a pan.
 */

type Rec = { id: string; [key: string]: unknown };
type Records = Record<CollectionName, Rec[]>;

const LAT = 12.9;
const LNG = 77.5;
const pole = (i: number): Rec => {
  const base = createSampleNetwork().equipment.find((e) => e.id === 'POLE-01')!;
  return { ...base, id: `E-${i}`, name: `Pole ${i}`, lat: LAT, lng: LNG + i * 0.01 };
};

function bigNetwork(): Records {
  const sample = createSampleNetwork() as unknown as Records;
  const cable = sample.cables[0];
  const equipment = Array.from({ length: 10 }, (_, i) => pole(i));
  const cables = [
    // Runs through every box along the row.
    { ...cable, id: 'C-1', name: 'Long cable', coordinates: [[LAT, LNG], [LAT, LNG + 0.09]], startEquipmentId: 'E-0', endEquipmentId: 'E-9' },
    // Drawn only near E-1, but its far end is E-8: loading E-1's area must load E-8 too.
    { ...cable, id: 'C-2', name: 'Short drawn cable', coordinates: [[LAT, LNG + 0.01], [LAT + 0.0005, LNG + 0.0105]], startEquipmentId: 'E-1', endEquipmentId: 'E-8' },
  ];
  const customers = Array.from({ length: 5 }, (_, i) => ({ ...sample.customers[0], id: `K-${i}`, name: `Customer ${i}`, lat: LAT + 0.0002, lng: LNG + i * 0.02 }));
  return { ...sample, equipment, cables, customers, spans: [], ducts: [], slackLoops: [], buildings: [] } as unknown as Records;
}

const touches = (record: Rec, data: Records, [s, w, n, e]: AreaBox): boolean => {
  const inside = (lat: unknown, lng: unknown) => typeof lat === 'number' && typeof lng === 'number' && lat >= s && lat <= n && lng >= w && lng <= e;
  if (inside(record.lat, record.lng)) return true;
  const line = record.coordinates as [number, number][] | undefined;
  if (line?.length) {
    // A straight line along the row: enough for these tests.
    const lats = line.map((p) => p[0]);
    const lngs = line.map((p) => p[1]);
    return Math.max(...lats) >= s && Math.min(...lats) <= n && Math.max(...lngs) >= w && Math.min(...lngs) <= e;
  }
  void data;
  return false;
};

function fakeServer({ areaRoutes = true, limit = 20_000 } = {}) {
  let revision = 1;
  let data = bigNetwork();
  const versions = new Map<string, number>();
  const log: { revision: number; name: CollectionName; id: string; deleted: boolean }[] = [];
  let outage: Error | null = null;
  const up = async () => {
    if (outage) throw outage;
  };
  const versionsOf = (subset: Partial<Records>) => {
    const out: Record<string, Record<string, number>> = {};
    for (const [name, list] of Object.entries(subset)) for (const r of list ?? []) (out[name] ??= {})[r.id] = versions.get(`${name}/${r.id}`) ?? 0;
    return out;
  };
  const write = (name: CollectionName, record: Rec | null, id = record?.id ?? '') => {
    revision += 1;
    if (record) {
      const i = data[name].findIndex((r) => r.id === id);
      if (i >= 0) data[name][i] = structuredClone(record);
      else data[name].push(structuredClone(record));
      versions.set(`${name}/${id}`, revision);
    } else data[name] = data[name].filter((r) => r.id !== id);
    log.push({ revision, name, id, deleted: !record });
  };
  const area = vi.fn(async (box: AreaBox, collections: readonly CollectionName[]) => {
    await up();
    if (!areaRoutes) throw new ApiError(404, 'not_found', 'Not found');
    const out: Partial<Records> = {};
    let count = 0;
    let truncated = false;
    for (const name of collections) {
      for (const r of data[name]) {
        if (!touches(r, data, box)) continue;
        if (count >= limit) {
          truncated = true;
          break;
        }
        count += 1;
        (out[name] ??= []).push(structuredClone(r));
      }
    }
    return { revision, bbox: [...box] as [number, number, number, number], data: out as Partial<NetworkSnapshot>, versions: versionsOf(out), truncated, limit };
  });
  const client: ApiClient = {
    health: vi.fn(async () => {
      await up();
      return { status: 'ok', version: 'test', uptimeSeconds: 1, revision, counts: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, data[n].length])) } as HealthResponse;
    }),
    getNetwork: vi.fn(async () => {
      await up();
      return { revision, data: structuredClone(data) as unknown as NetworkSnapshot, versions: versionsOf(data) };
    }),
    getNetworkExcept: vi.fn(async (except: readonly CollectionName[]) => {
      await up();
      if (!areaRoutes) throw new ApiError(404, 'not_found', 'Not found');
      const out = Object.fromEntries(COLLECTION_NAMES.filter((n) => !except.includes(n)).map((n) => [n, structuredClone(data[n])])) as Partial<Records>;
      return { revision, data: out as Partial<NetworkSnapshot>, versions: versionsOf(out) };
    }),
    getArea: area,
    getRecords: vi.fn(async (ids: readonly string[], collections: readonly CollectionName[]) => {
      await up();
      const out: Partial<Records> = {};
      for (const name of collections) for (const r of data[name]) if (ids.includes(r.id)) (out[name] ??= []).push(structuredClone(r));
      return { revision, data: out as Partial<NetworkSnapshot>, versions: versionsOf(out) };
    }),
    getChanges: vi.fn(async (since: number) => {
      await up();
      const upserts: Partial<Records> = {};
      const deletes: Record<string, string[]> = {};
      const seen = new Set<string>();
      for (const entry of [...log].reverse()) {
        if (entry.revision <= since || seen.has(`${entry.name}/${entry.id}`)) continue;
        seen.add(`${entry.name}/${entry.id}`);
        const record = data[entry.name].find((r) => r.id === entry.id);
        if (entry.deleted || !record) (deletes[entry.name] ??= []).push(entry.id);
        else (upserts[entry.name] ??= []).push(structuredClone(record));
      }
      return { revision, since, upserts: upserts as never, deletes, versions: versionsOf(upserts) };
    }),
    search: vi.fn(async (query: string) => {
      await up();
      const hits = AREA_COLLECTIONS.flatMap((name) => data[name].filter((r) => String(r.name ?? '').includes(query)).map((r) => ({ kind: 'equipment', collection: name, id: r.id, label: String(r.name), matched: { field: 'Name', value: String(r.name) } })));
      return { total: hits.length, hits: hits as never };
    }),
    applyChanges: vi.fn(async (changes: ChangeSet) => {
      await up();
      let upserted = 0;
      for (const [name, list] of Object.entries(changes.upserts ?? {})) {
        for (const r of (list ?? []) as Rec[]) {
          write(name as CollectionName, r);
          upserted += 1;
        }
      }
      return { revision, upserted, deleted: 0, versions: {} };
    }),
    restore: vi.fn(),
    reset: vi.fn(),
    route: vi.fn(),
  };
  return {
    client,
    area,
    get revision() {
      return revision;
    },
    records: (name: CollectionName) => data[name],
    editElsewhere: (name: CollectionName, record: Rec) => write(name, record),
    deleteElsewhere: (name: CollectionName, id: string) => write(name, null, id),
    goDown: () => (outage = new ApiUnavailableError('The FiberGIS server could not be reached.')),
    comeBack: () => (outage = null),
    replace: (next: Records) => (data = next),
  };
}

const pristine = useNetworkStore.getState();
let server: ReturnType<typeof fakeServer>;
let engine: SyncEngine;
const POLL = 5_000;

const ids = (name: CollectionName) => (useNetworkStore.getState()[name] as unknown as Rec[]).map((r) => r.id).sort();
const idle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await engine.flush();
};
const start = async (options: { areaModeMinRecords?: number } = {}) => {
  engine = createSyncEngine({ client: server.client, debounceMs: 50, maxWaitMs: 500, pollIntervalMs: POLL, retryBaseMs: 1_000, areaDebounceMs: 100, viewSize: () => ({ width: 400, height: 400 }), areaModeMinRecords: 5, ...options });
  engine.start();
  await idle();
};
/** Moves the map, as a pan does, and waits for the area load. */
const panTo = async (lat: number, lng: number) => {
  useMapStore.getState().setViewport({ lat, lng, zoom: 18 });
  await vi.advanceTimersByTimeAsync(150);
  await idle();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useMapStore.getState().setViewport({ lat: LAT, lng: LNG, zoom: 18 });
  server = fakeServer();
});
afterEach(() => {
  engine?.stop();
  vi.useRealTimers();
});

describe('area helpers', () => {
  it('a view box covers the screen around the centre, and a box inside a loaded one needs no load', () => {
    const box = viewBox({ lat: LAT, lng: LNG, zoom: 18 }, { width: 400, height: 400 });
    expect(box[0]).toBeLessThan(LAT);
    expect(box[2]).toBeGreaterThan(LAT);
    expect(box[3] - box[1]).toBeGreaterThan(400 * (360 / (256 * 2 ** 18)));
    expect(isCovered([box], viewBox({ lat: LAT, lng: LNG, zoom: 19 }, { width: 400, height: 400 }))).toBe(true);
    expect(isCovered([box], viewBox({ lat: LAT, lng: LNG + 0.01, zoom: 18 }, { width: 400, height: 400 }))).toBe(false);
    // Never past the poles or the 180° line.
    expect(viewBox({ lat: 89, lng: 179.9, zoom: 2 }, { width: 2000, height: 2000 })).toEqual([expect.any(Number), expect.any(Number), 90, 180]);
  });

  it('merging adds and replaces, never removes, and keeps unsent records as they are here', () => {
    const local = { ...createSampleNetwork(), equipment: [pole(0), pole(1)] } as unknown as NetworkSnapshot;
    const changed = mergeLoaded(local, { equipment: [{ ...pole(1), name: 'Server name' }, pole(2)] as never }, { equipment: ['E-1'] });
    expect((changed.equipment as unknown as Rec[]).map((r) => [r.id, r.name])).toEqual([
      ['E-0', 'Pole 0'],
      ['E-1', 'Pole 1'],
      ['E-2', 'Pole 2'],
    ]);
    // Nothing new: no collection changes, so nothing redraws.
    expect(mergeLoaded(local, { equipment: [pole(0)] as never }, {})).toEqual({});
  });

  it('finds the records loaded ones point to that are not here', () => {
    const data = bigNetwork();
    const snapshot = { ...data, equipment: [pole(1)] } as unknown as NetworkSnapshot;
    const missing = missingReferences({ cables: [data.cables[1]] as never }, snapshot);
    // Its far end (nested links, such as the sample cable's fibre ends at boxes, count too); not E-1, which is here.
    expect(missing).toContain('E-8');
    expect(missing).not.toContain('E-1');
    // Ids of collections loaded in full (a splitter, a catalogue model) are never asked for.
    expect(missingReferences({ equipment: [{ ...pole(1), catalogModelId: snapshot.catalog[0]?.id ?? 'CAT' }] as never }, snapshot).filter((id) => id === snapshot.catalog[0]?.id)).toEqual([]);
  });
});

describe('loading a big network by map area', () => {
  it('a small network is still loaded whole, as before', async () => {
    await start({ areaModeMinRecords: 1_000 });
    expect(server.client.getNetwork).toHaveBeenCalled();
    expect(server.area).not.toHaveBeenCalled();
    expect(useAreaLoadStore.getState().mode).toBe('whole');
    expect(ids('equipment')).toHaveLength(10);
  });

  it('a big one loads the area in view, every other collection in full, and says it is part loaded', async () => {
    await start();
    expect(server.client.getNetwork).not.toHaveBeenCalled();
    // E-0 is in view; C-1 runs through it and ends at E-9, which is loaded as the cable's end.
    expect(ids('equipment')).toEqual(['E-0', 'E-9']);
    expect(ids('cables')).toEqual(['C-1']);
    expect(ids('customers')).toEqual(['K-0']);
    expect(useNetworkStore.getState().splitters.map((s) => s.id).sort()).toEqual(server.records('splitters').map((s) => s.id).sort());
    expect(useAreaLoadStore.getState()).toMatchObject({ mode: 'area', areas: 1, truncated: false, serverRecords: 17, loadedRecords: 4 });
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', revision: server.revision });
    expect(JSON.parse(localStorage.getItem(storageKey(SYNC_META_STORAGE_KEY)) ?? 'null')).toMatchObject({ mode: 'area' });
  });

  it('a pan loads the new area and its links, and keeps what was loaded before', async () => {
    await start();
    await panTo(LAT, LNG + 0.01);
    // E-1's area: C-2 is drawn there and ends at E-8 far away, so E-8 comes too.
    expect(ids('equipment')).toEqual(['E-0', 'E-1', 'E-8', 'E-9']);
    expect(ids('cables')).toEqual(['C-1', 'C-2']);
    expect(useAreaLoadStore.getState().areas).toBe(2);
    // Back to a loaded place: no new request.
    const calls = server.area.mock.calls.length;
    await panTo(LAT, LNG);
    expect(server.area.mock.calls.length).toBe(calls);
  });

  it('changes made anywhere arrive, and a record deleted elsewhere goes, even outside the loaded area', async () => {
    await start();
    server.editElsewhere('equipment', { ...pole(9), name: 'Renamed far away' });
    server.editElsewhere('equipment', pole(5));
    server.deleteElsewhere('equipment', 'E-0');
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    const equipment = useNetworkStore.getState().equipment as unknown as Rec[];
    expect(equipment.find((r) => r.id === 'E-9')?.name).toBe('Renamed far away');
    expect(equipment.map((r) => r.id).sort()).toEqual(['E-5', 'E-9']);
    expect(server.client.getNetwork).not.toHaveBeenCalled();
  });

  it('an edit made here is sent, and a later area load never overwrites it before it is sent', async () => {
    await start();
    server.goDown();
    const [first, ...rest] = useNetworkStore.getState().equipment;
    useNetworkStore.setState({ equipment: [{ ...first, name: 'Edited offline' }, ...rest] });
    await vi.advanceTimersByTimeAsync(100);
    expect(useSyncStore.getState().pendingCount).toBe(1);
    // Still part loaded while offline, with the edit kept.
    expect(useAreaLoadStore.getState().mode).toBe('area');
    server.editElsewhere('equipment', { ...pole(0), name: 'Server name' });
    server.comeBack();
    await vi.advanceTimersByTimeAsync(2_000);
    await idle();
    expect(server.records('equipment').find((r) => r.id === 'E-0')?.name).toBe('Edited offline');
    expect((useNetworkStore.getState().equipment as unknown as Rec[]).find((r) => r.id === 'E-0')?.name).toBe('Edited offline');
  });

  it('a copy loaded by area says so at the next start, before the server answers', async () => {
    await start();
    engine.stop();
    server.goDown();
    await start();
    expect(useSyncStore.getState().phase).toBe('offline');
    expect(useAreaLoadStore.getState().mode).toBe('area');
    expect(ids('equipment')).toEqual(['E-0', 'E-9']);
  });

  it('an area with more records than one answer carries is marked, and is loaded again on zooming in', async () => {
    server = fakeServer({ limit: 1 });
    await start();
    expect(useAreaLoadStore.getState()).toMatchObject({ mode: 'area', truncated: true, areas: 0 });
    const calls = server.area.mock.calls.length;
    useMapStore.getState().setViewport({ lat: LAT, lng: LNG, zoom: 19 });
    await vi.advanceTimersByTimeAsync(150);
    await idle();
    expect(server.area.mock.calls.length).toBe(calls + 1);
  });

  it('a wide view loads only its middle, and says so', async () => {
    await start();
    useMapStore.getState().setViewport({ lat: LAT, lng: LNG + 0.04, zoom: 10 });
    await vi.advanceTimersByTimeAsync(150);
    await idle();
    const [box] = server.area.mock.calls.at(-1)!;
    // As wide as at zoom 16, not the whole zoom-10 view.
    expect(box[3] - box[1]).toBeCloseTo((400 * 1.5 * 360) / (256 * 2 ** 16), 6);
    expect(useAreaLoadStore.getState()).toMatchObject({ mode: 'area', wide: true });
    expect(ids('equipment')).toContain('E-4');
    expect(ids('equipment')).not.toContain('E-6');
  });

  it('the server search finds what is not loaded and loads it', async () => {
    await start();
    await expect(engine.searchServer('Pole 4')).resolves.toEqual({ total: 1, loaded: 1 });
    expect(ids('equipment')).toContain('E-4');
    await expect(engine.searchServer('Pole 4')).resolves.toEqual({ total: 1, loaded: 0 });
  });

  it('"whole network" on this device, and an older server without the area routes, load everything', async () => {
    writeLoadPreference('whole');
    await start();
    expect(useAreaLoadStore.getState().mode).toBe('whole');
    expect(ids('equipment')).toHaveLength(10);
    await engine.setLoadPreference('auto');
    expect(useAreaLoadStore.getState().mode).toBe('area');
    expect(ids('equipment')).toEqual(['E-0', 'E-9']);
    engine.stop();

    server = fakeServer({ areaRoutes: false });
    await start();
    expect(server.client.getNetwork).toHaveBeenCalled();
    expect(useAreaLoadStore.getState().mode).toBe('whole');
    expect(ids('equipment')).toHaveLength(10);
    await expect(engine.searchServer('Pole 4')).resolves.toBeNull();
  });
});
