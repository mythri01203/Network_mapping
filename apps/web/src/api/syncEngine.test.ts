import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ChangeSet,
  changeSetSchema,
  COLLECTION_NAMES,
  type CollectionName,
  type HealthResponse,
  type NetworkSnapshot,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { storageKey } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import type * as NetworkStore from '../stores/networkStore';
import { getNetworkSnapshot, SYNC_META_STORAGE_KEY, useNetworkStore, wasLoadedFromCache } from '../stores/networkStore';
import { useSyncStore } from '../stores/syncStore';
import { useToastStore } from '../stores/toastStore';
import { type ApiClient, ApiError, ApiUnavailableError } from './client';
import { createSyncEngine, type SyncEngine } from './syncEngine';

vi.mock('../stores/networkStore', async (importOriginal) => ({
  ...(await importOriginal<typeof NetworkStore>()),
  wasLoadedFromCache: vi.fn(() => false),
}));

const DEBOUNCE = 100;
const MAX_WAIT = 1_000;
const POLL = 5_000;
const RETRY = 1_000;

type Records = Record<CollectionName, { id: string }[]>;

/**
 * In-memory stand-in for the API server with the same revision rules. With `versioned`, it also
 * keeps a version per record and refuses stale edits, like the Phase 8 server.
 */
function createFakeServer({ versioned = false, incremental = true } = {}) {
  let revision = 1;
  let data = createSampleNetwork() as unknown as Records;
  /** Phase 24: the revision each record was last stored or deleted at, and how far back that reaches. */
  const changeLog = new Map<string, { revision: number; deleted: boolean }>();
  let floor = 1;
  const mark = (name: string, id: string, at: number, deleted: boolean) => changeLog.set(JSON.stringify([name, id]), { revision: at, deleted });
  let outage: Error | null = null;
  let refusal: ApiError | null = null;
  /** Records the server refuses one by one, like a validation failure on a single record. */
  const refusedIds = new Set<string>();
  const versions = new Map<string, number>();
  const versionOf = (name: string, id: string) => versions.get(`${name}/${id}`) ?? 0;
  const versionsMap = () => {
    if (!versioned) return undefined;
    const out: Record<string, Record<string, number>> = {};
    for (const name of COLLECTION_NAMES) for (const r of data[name]) (out[name] ??= {})[r.id] = versionOf(name, r.id);
    return out;
  };

  const available = async () => {
    if (outage) throw outage;
  };
  const snapshot = () => structuredClone(data) as unknown as NetworkSnapshot;

  const applyChanges = vi.fn<ApiClient['applyChanges']>(async (changes: ChangeSet) => {
    await available();
    if (refusal) throw refusal;
    if (versioned) {
      const conflicts = [];
      for (const [name, byId] of Object.entries(changes.expect ?? {}) as [CollectionName, Record<string, number>][]) {
        for (const [id, expected] of Object.entries(byId)) {
          const record = data[name].find((r) => r.id === id);
          const deleting = (changes.deletes?.[name] ?? []).includes(id);
          if (!record && deleting) continue;
          const current = record ? versionOf(name, id) : null;
          if (current !== expected) conflicts.push({ collection: name, id, expected, current, record: record ? structuredClone(record) : null });
        }
      }
      if (conflicts.length > 0) throw new ApiError(409, 'version_conflict', 'Someone else changed it.', [], conflicts as never);
    }
    const touched = [
      ...Object.values(changes.upserts ?? {}).flatMap((records) => (records as { id: string }[]).map((r) => r.id)),
      ...Object.values(changes.deletes ?? {}).flat(),
    ];
    const bad = touched.find((id) => refusedIds.has(id as string));
    if (bad) throw new ApiError(400, 'validation_error', `Record ${bad} is not valid.`);
    expect(changeSetSchema.safeParse(changes).success).toBe(true);
    let upserted = 0;
    let deleted = 0;
    const written: Record<string, Record<string, number>> = {};
    for (const [name, records] of Object.entries(changes.upserts ?? {}) as [CollectionName, { id: string }[]][]) {
      for (const record of records) {
        const index = data[name].findIndex((item) => item.id === record.id);
        if (index >= 0) data[name][index] = structuredClone(record);
        else data[name].push(structuredClone(record));
        versions.set(`${name}/${record.id}`, revision + 1);
        (written[name] ??= {})[record.id] = revision + 1;
        mark(name, record.id, revision + 1, false);
        upserted += 1;
      }
    }
    for (const [name, ids] of Object.entries(changes.deletes ?? {}) as [CollectionName, string[]][]) {
      const before = data[name].length;
      for (const id of ids) if (data[name].some((item) => item.id === id)) mark(name, id, revision + 1, true);
      data[name] = data[name].filter((item) => !ids.includes(item.id));
      deleted += before - data[name].length;
    }
    if (upserted + deleted > 0) revision += 1;
    return versioned ? { revision, upserted, deleted, versions: written } : { revision, upserted, deleted };
  });

  const client: ApiClient = {
    health: vi.fn(async () => {
      await available();
      const counts = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, data[name].length]));
      return { status: 'ok', version: 'test', uptimeSeconds: 1, revision, counts } as HealthResponse;
    }),
    getNetwork: vi.fn(async () => {
      await available();
      const v = versionsMap();
      return v ? { revision, data: snapshot(), versions: v } : { revision, data: snapshot() };
    }),
    ...(incremental
      ? {
          getChanges: vi.fn<NonNullable<ApiClient['getChanges']>>(async (since) => {
            await available();
            if (since > revision || since < floor) return { revision, since, reload: true as const, reason: 'too old' };
            const upserts: Record<string, { id: string }[]> = {};
            const deletes: Record<string, string[]> = {};
            const changed: Record<string, Record<string, number>> = {};
            for (const [key, entry] of changeLog) {
              if (entry.revision <= since) continue;
              const [name, id] = JSON.parse(key) as [CollectionName, string];
              const record = data[name].find((r) => r.id === id);
              if (entry.deleted || !record) (deletes[name] ??= []).push(id);
              else (changed[name] ??= {})[id] = versionOf(name, id);
            }
            // Stored order, as the server sends it.
            for (const [name, byId] of Object.entries(changed)) upserts[name] = structuredClone(data[name as CollectionName].filter((r) => r.id in byId));
            return { revision, since, upserts: upserts as never, deletes, versions: changed };
          }),
        }
      : {}),
    applyChanges,
    reset: vi.fn(async () => {
      await available();
      data = { ...(createSampleNetwork() as unknown as Records), catalog: data.catalog };
      revision += 1;
      floor = revision;
      return { revision };
    }),
    restore: vi.fn(async (backup) => {
      await available();
      const restored = Object.keys(backup.collections) as CollectionName[];
      for (const name of restored) data[name] = structuredClone(backup.collections[name] as { id: string }[]);
      revision += 1;
      floor = revision;
      return { revision, restored };
    }),
    route: vi.fn(),
  };

  return {
    client,
    applyChanges,
    get revision() {
      return revision;
    },
    records: (name: CollectionName) => data[name],
    goDown: () => {
      outage = new ApiUnavailableError('The FiberGIS server could not be reached.');
    },
    comeBack: () => {
      outage = null;
    },
    refuse: (error: ApiError | null) => {
      refusal = error;
    },
    refuseRecord: (id: string) => refusedIds.add(id),
    acceptRecord: (id: string) => refusedIds.delete(id),
    /** Another client edits the network. */
    editElsewhere: (name: CollectionName, record: { id: string }) => {
      const index = data[name].findIndex((item) => item.id === record.id);
      if (index >= 0) data[name][index] = record;
      else data[name].push(record);
      revision += 1;
      versions.set(`${name}/${record.id}`, revision);
      mark(name, record.id, revision, false);
    },
    /** Another client deletes a record. */
    deleteElsewhere: (name: CollectionName, id: string) => {
      data[name] = data[name].filter((item) => item.id !== id);
      revision += 1;
      versions.delete(`${name}/${id}`);
      mark(name, id, revision, true);
    },
    /** The server's change history no longer reaches back (a restore elsewhere, a long time away). */
    forgetHistory: () => {
      floor = revision + 1;
    },
  };
}

const pristine = useNetworkStore.getState();
let server: ReturnType<typeof createFakeServer>;
let engine: SyncEngine;

const startEngine = async () => {
  engine = createSyncEngine({
    client: server.client,
    debounceMs: DEBOUNCE,
    maxWaitMs: MAX_WAIT,
    pollIntervalMs: POLL,
    retryBaseMs: RETRY,
    retryMaxMs: RETRY * 4,
  });
  engine.start();
  await idle();
};

/** Waits for queued server round-trips (flush runs after everything already queued). */
const idle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await engine.flush();
};

const renameFirstEquipment = (name: string) => {
  const [first, ...rest] = useNetworkStore.getState().equipment;
  useNetworkStore.setState({ equipment: [{ ...first, name }, ...rest] });
  return first.id;
};

const serverEquipment = (id: string) => server.records('equipment').find((item) => item.id === id) as { name?: string };
const phase = () => useSyncStore.getState().phase;
const storedMeta = () => JSON.parse(localStorage.getItem(storageKey(SYNC_META_STORAGE_KEY)) ?? 'null');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useToastStore.setState({ toasts: [] });
  vi.mocked(wasLoadedFromCache).mockReturnValue(false);
  server = createFakeServer();
});

afterEach(() => {
  engine?.stop();
  vi.useRealTimers();
});

describe('connecting', () => {
  it('loads the server network and records its revision', async () => {
    const [first] = server.records('equipment');
    server.editElsewhere('equipment', { ...first, name: 'Renamed on server' } as { id: string });
    await startEngine();

    expect(useNetworkStore.getState().equipment[0].name).toBe('Renamed on server');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', revision: server.revision, pendingCount: 0 });
    expect(storedMeta()).toEqual({ revision: server.revision, pending: {} });
    expect(server.applyChanges).not.toHaveBeenCalled();
  });

  it('keeps unchanged collections untouched', async () => {
    const before = useNetworkStore.getState();
    await startEngine();
    const after = useNetworkStore.getState();
    expect(after.equipment).toBe(before.equipment);
    expect(after.history).toBe(before.history);
  });

  it('uploads edits a browser made before it had a server', async () => {
    const id = renameFirstEquipment('Edited offline long ago');
    vi.mocked(wasLoadedFromCache).mockReturnValue(true);
    await startEngine();

    expect(serverEquipment(id).name).toBe('Edited offline long ago');
    expect(phase()).toBe('synced');
  });
});

describe('saving local edits', () => {
  it('sends an edit after a quiet period', async () => {
    await startEngine();
    const id = renameFirstEquipment('Local rename');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'pending', pendingCount: 1 });

    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    expect(server.applyChanges).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await idle();

    expect(server.applyChanges).toHaveBeenCalledTimes(1);
    expect(serverEquipment(id).name).toBe('Local rename');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', pendingCount: 0, revision: server.revision });
  });

  it('sends deletions', async () => {
    await startEngine();
    const [removed, ...rest] = useNetworkStore.getState().equipment;
    useNetworkStore.setState({ equipment: rest });
    await idle();
    expect(serverEquipment(removed.id)).toBeUndefined();
  });

  it('does not let continuous editing postpone saving forever', async () => {
    await startEngine();
    for (let elapsed = 0; elapsed < MAX_WAIT; elapsed += DEBOUNCE / 2) {
      renameFirstEquipment(`Typing ${elapsed}`);
      await vi.advanceTimersByTimeAsync(DEBOUNCE / 2);
    }
    await idle();
    expect(server.applyChanges).toHaveBeenCalledTimes(1);
  });

  it('picks up changes another client made while saving', async () => {
    await startEngine();
    const other = server.records('cables')[0];
    server.editElsewhere('cables', { ...other, name: 'Changed by a colleague' } as { id: string });
    renameFirstEquipment('Mine');
    await idle();

    expect(useNetworkStore.getState().equipment[0].name).toBe('Mine');
    expect(useNetworkStore.getState().cables[0].name).toBe('Changed by a colleague');
    expect(useSyncStore.getState().revision).toBe(server.revision);
  });

  it('polls for changes made elsewhere while idle', async () => {
    await startEngine();
    const other = server.records('cables')[0];
    server.editElsewhere('cables', { ...other, name: 'Polled' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    expect(useNetworkStore.getState().cables[0].name).toBe('Polled');
  });
});

describe('when the server is unavailable', () => {
  it('keeps working offline and pushes edits once it is back', async () => {
    server.goDown();
    await startEngine();
    expect(phase()).toBe('offline');

    const id = renameFirstEquipment('Offline edit');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(server.applyChanges).not.toHaveBeenCalled();
    expect(useSyncStore.getState()).toMatchObject({ phase: 'offline', pendingCount: 1 });
    expect(storedMeta().pending).toEqual({ equipment: [id] });

    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY);
    await idle();
    expect(serverEquipment(id).name).toBe('Offline edit');
    expect(phase()).toBe('synced');
  });

  it('goes offline when a save fails and retries with backoff', async () => {
    await startEngine();
    server.goDown();
    const id = renameFirstEquipment('Unsent');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await idle();
    expect(phase()).toBe('offline');
    expect(useSyncStore.getState().error).toMatch(/could not be reached/);

    await vi.advanceTimersByTimeAsync(RETRY);
    expect(phase()).toBe('offline');
    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY * 2);
    await idle();
    expect(serverEquipment(id).name).toBe('Unsent');
    expect(phase()).toBe('synced');
  });

  it('remembers unsent edits across reloads', async () => {
    server.goDown();
    await startEngine();
    const id = renameFirstEquipment('Before reload');
    engine.stop();

    server.comeBack();
    await startEngine();
    expect(serverEquipment(id).name).toBe('Before reload');
  });
});

describe('when the server refuses changes', () => {
  beforeEach(() => {
    server.refuse(new ApiError(400, 'validation_failed', 'Invalid change set.'));
  });

  // Updated in Phase 1: a refused record is now reported by name with a next action, instead of the
  // generic "Server Rejected Changes" toast and bare server message.
  it('keeps the edits, reports the error once and waits for the user', async () => {
    await startEngine();
    renameFirstEquipment('Refused');
    await idle();
    expect(useToastStore.getState().toasts.map((toast) => toast.title)).toEqual(['One Item Was Not Sent']);

    await vi.advanceTimersByTimeAsync(POLL * 3);
    expect(useSyncStore.getState()).toMatchObject({ phase: 'error', pendingCount: 1 });
    expect(useSyncStore.getState().error).toMatch(/Refused .* was not sent\. Invalid change set\. Correct it, then tap Retry now\./);
    expect(server.applyChanges).toHaveBeenCalledTimes(1);

    server.refuse(null);
    await engine.retry();
    expect(phase()).toBe('synced');
  });

  it('can discard the refused edits', async () => {
    await startEngine();
    const original = useNetworkStore.getState().equipment[0].name;
    renameFirstEquipment('Refused');
    await idle();

    await engine.discardLocalChanges();
    expect(useNetworkStore.getState().equipment[0].name).toBe(original);
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', pendingCount: 0 });
  });
});

describe('when the server refuses one record', () => {
  const renameEquipment = (index: number, name: string) => {
    const equipment = [...useNetworkStore.getState().equipment];
    equipment[index] = { ...equipment[index], name };
    useNetworkStore.setState({ equipment });
    return equipment[index].id;
  };

  it('still sends every other record and names the refused one', async () => {
    await startEngine();
    const bad = useNetworkStore.getState().equipment[1].id;
    server.refuseRecord(bad);
    const good = renameEquipment(0, 'Good edit');
    renameEquipment(1, 'Bad edit');
    const alsoGood = renameEquipment(2, 'Another good edit');
    await idle();

    expect(serverEquipment(good).name).toBe('Good edit');
    expect(serverEquipment(alsoGood).name).toBe('Another good edit');
    expect(serverEquipment(bad).name).not.toBe('Bad edit');

    const state = useSyncStore.getState();
    expect(state.phase).toBe('error');
    expect(state.pendingCount).toBe(1);
    expect(state.refused).toEqual([
      expect.objectContaining({ collection: 'equipment', id: bad, label: `Bad edit (${bad})`, reason: expect.stringContaining('not valid') }),
    ]);
    expect(state.error).toContain('Correct it, then tap Retry now');
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Everything else was sent');
    // The refused edit stays in this browser.
    expect(useNetworkStore.getState().equipment[1].name).toBe('Bad edit');
    expect(storedMeta().pending.equipment).toContain(bad);
  });

  it('keeps sending later edits while one record stays refused', async () => {
    await startEngine();
    const bad = useNetworkStore.getState().equipment[1].id;
    server.refuseRecord(bad);
    renameEquipment(1, 'Bad edit');
    await idle();

    const later = renameEquipment(3, 'Later edit');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await idle();
    expect(serverEquipment(later).name).toBe('Later edit');
    expect(useSyncStore.getState().refused.map((r) => r.id)).toEqual([bad]);
  });

  it('sends the record again once it is corrected', async () => {
    await startEngine();
    const bad = useNetworkStore.getState().equipment[1].id;
    server.refuseRecord(bad);
    renameEquipment(1, 'Bad edit');
    await idle();

    server.acceptRecord(bad);
    renameEquipment(1, 'Fixed edit');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await idle();
    expect(serverEquipment(bad).name).toBe('Fixed edit');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', refused: [], pendingCount: 0 });
  });

  it('retries the refused record when asked', async () => {
    await startEngine();
    const bad = useNetworkStore.getState().equipment[1].id;
    server.refuseRecord(bad);
    renameEquipment(1, 'Bad edit');
    await idle();

    server.acceptRecord(bad);
    await engine.retry();
    expect(serverEquipment(bad).name).toBe('Bad edit');
    expect(useSyncStore.getState().phase).toBe('synced');
  });
});

describe('reset and restore', () => {
  it('resets on the server while online', async () => {
    await startEngine();
    renameFirstEquipment('Soon gone');
    await expect(engine.reset()).resolves.toBe('server');

    expect(server.client.reset).toHaveBeenCalled();
    expect(getNetworkSnapshot().equipment).toEqual(createSampleNetwork().equipment);
    expect(phase()).toBe('synced');
  });

  it('refuses a reset while offline and changes nothing (Phase 9: the server saves a safety copy first)', async () => {
    await startEngine();
    const id = renameFirstEquipment('Saved first');
    await idle();
    server.goDown();
    await vi.advanceTimersByTimeAsync(POLL);

    await expect(engine.reset()).resolves.toBe('failed');
    expect(getNetworkSnapshot().equipment.find((e) => e.id === id)?.name).toBe('Saved first');
    expect(server.client.reset).not.toHaveBeenCalled();
  });

  it('keeps unsent work when the server asks for a login, and sends it after login (Phase 9)', async () => {
    await startEngine();
    server.goDown();
    await vi.advanceTimersByTimeAsync(POLL);
    const id = renameFirstEquipment('Edited while logged out');
    vi.mocked(server.client.getNetwork).mockRejectedValueOnce(new ApiError(401, 'login_required', 'Please log in.'));
    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY * 4);
    await idle();
    expect(phase()).toBe('signin');
    expect(useAuthStore.getState().loginNeeded).toBe(true);
    expect(engine.unsentIds().equipment).toContain(id);
    expect(server.records('equipment').find((e) => e.id === id)).not.toMatchObject({ name: 'Edited while logged out' });

    useAuthStore.setState({ account: { id: 'U1', username: 'ravi', displayName: 'Ravi', role: 'engineer' }, loginNeeded: false });
    await idle();
    expect(server.records('equipment').find((e) => e.id === id)).toMatchObject({ name: 'Edited while logged out' });
    useAuthStore.setState({ account: null });
  });

  it('restores on the server and applies the start point locally', async () => {
    await startEngine();
    await expect(engine.restore({ collections: { zones: [] }, projectStartPoint: [1, 2] })).resolves.toBe('server');

    expect(server.records('zones')).toEqual([]);
    expect(useNetworkStore.getState().zones).toEqual([]);
    expect(useNetworkStore.getState().projectStartPoint).toEqual([1, 2]);
  });

  it('reports a refused restore as failed', async () => {
    await startEngine();
    vi.mocked(server.client.restore).mockRejectedValueOnce(new ApiError(400, 'invalid_backup', 'Bad backup.'));
    await expect(engine.restore({ collections: { zones: [] } })).resolves.toBe('failed');
    expect(useNetworkStore.getState().zones).toEqual(createSampleNetwork().zones);
  });
});

describe('offline edits that clash (Phase 8, example E)', () => {
  /** The office renames a record while this device, offline, renamed it too. */
  async function clash() {
    server = createFakeServer({ versioned: true });
    await startEngine();
    const [first] = server.records('equipment') as { id: string; name: string }[];
    server.goDown();
    await vi.advanceTimersByTimeAsync(POLL);
    const id = renameFirstEquipment('Phone version');
    server.editElsewhere('equipment', { ...first, name: 'Office version' } as { id: string });
    // Something else edited offline that nobody else touched.
    const [cable] = useNetworkStore.getState().cables;
    useNetworkStore.setState({ cables: useNetworkStore.getState().cables.map((c) => (c.id === cable.id ? { ...c, name: 'Phone cable' } : c)) });
    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY * 4);
    await idle();
    return { id, cableId: cable.id };
  }

  const conflictsFor = (id: string) => useNetworkStore.getState().syncConflicts.filter((c) => c.recordId === id);

  it('sends edits with the version they started from, and other edits still go through', async () => {
    const { id, cableId } = await clash();
    const sent = server.applyChanges.mock.calls.map(([changes]) => changes);
    expect(sent.some((c) => c.expect?.equipment?.[id] !== undefined)).toBe(true);
    // Nothing of the phone's was lost, and nothing of the office's was overwritten.
    expect(serverEquipment(id).name).toBe('Office version');
    expect(useNetworkStore.getState().equipment.find((e) => e.id === id)?.name).toBe('Phone version');
    expect((server.records('cables').find((c) => c.id === cableId) as unknown as { name: string }).name).toBe('Phone cable');
    const [conflict] = conflictsFor(id);
    expect(conflict).toMatchObject({ collection: 'equipment', status: 'open', mine: expect.objectContaining({ name: 'Phone version' }), theirs: expect.objectContaining({ name: 'Office version' }) });
    expect(conflict.changedFields).toEqual(['name']);
    expect(useSyncStore.getState().held).toEqual([`equipment/${id}`]);
    // The conflict record itself reached the office.
    expect(server.records('syncConflicts').map((c) => c.id)).toContain(conflict.id);
    expect(useToastStore.getState().toasts.some((t) => t.title === 'Someone else changed this')).toBe(true);
    expect(storedMeta().held).toEqual({ equipment: [id] });
  });

  it('keep mine sends the phone version over the office one, checked against the version shown', async () => {
    const { id } = await clash();
    const [conflict] = conflictsFor(id);
    await expect(engine.resolveConflict(conflict.id, 'mine')).resolves.toBe(true);
    await idle();
    expect(serverEquipment(id).name).toBe('Phone version');
    expect(conflictsFor(id)[0]).toMatchObject({ status: 'kept_mine', theirs: expect.objectContaining({ name: 'Office version' }) });
    expect(useSyncStore.getState().held).toEqual([]);
  });

  it('keep theirs and office decides show the office version here, and both versions stay in the record', async () => {
    const { id } = await clash();
    const [conflict] = conflictsFor(id);
    await engine.resolveConflict(conflict.id, 'office');
    await idle();
    expect(useNetworkStore.getState().equipment.find((e) => e.id === id)?.name).toBe('Office version');
    expect(serverEquipment(id).name).toBe('Office version');
    const saved = server.records('syncConflicts').find((c) => c.id === conflict.id) as unknown as { status: string; mine: { name: string } };
    expect(saved).toMatchObject({ status: 'office_decides', mine: { name: 'Phone version' } });
    // Later edits are checked against the office version and go through.
    renameFirstEquipment('After the choice');
    await idle();
    expect(serverEquipment(id).name).toBe('After the choice');
  });

  it('is not a conflict when both sides already hold the same record', async () => {
    server = createFakeServer({ versioned: true });
    await startEngine();
    const [first] = server.records('equipment') as { id: string; name: string }[];
    server.goDown();
    await vi.advanceTimersByTimeAsync(POLL);
    const id = renameFirstEquipment('Same both sides');
    server.editElsewhere('equipment', { ...useNetworkStore.getState().equipment[0] } as { id: string });
    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY * 4);
    await idle();
    expect(first.id).toBe(id);
    expect(conflictsFor(id)).toEqual([]);
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', held: [] });
  });

  it('keeps last-write-wins with a server that sends no versions', async () => {
    await startEngine();
    const [first] = server.records('equipment');
    renameFirstEquipment('Mine');
    server.editElsewhere('equipment', { ...first, name: 'Theirs' } as { id: string });
    await idle();
    expect(server.applyChanges.mock.calls.every(([c]) => c.expect === undefined)).toBe(true);
    expect(serverEquipment(first.id).name).toBe('Mine');
  });
});

describe('incremental sync (Phase 24)', () => {
  it('a poll fetches only what changed, not the whole network', async () => {
    await startEngine();
    expect(server.client.getNetwork).toHaveBeenCalledTimes(1);
    const other = server.records('cables')[0];
    server.editElsewhere('cables', { ...other, name: 'Changed elsewhere' } as { id: string });
    const gone = server.records('customers')[0].id;
    server.deleteElsewhere('customers', gone);
    server.editElsewhere('zones', { ...server.records('zones')[0], id: 'ZONE-NEW', name: 'New zone' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    expect(server.client.getNetwork).toHaveBeenCalledTimes(1);
    expect(server.client.getChanges).toHaveBeenCalledWith(server.revision - 3);
    const state = useNetworkStore.getState();
    expect(state.cables[0].name).toBe('Changed elsewhere');
    expect(state.customers.some((c) => c.id === gone)).toBe(false);
    expect(state.zones.at(-1)?.id).toBe('ZONE-NEW');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', revision: server.revision });
    // The result is what a whole load would give.
    expect(getNetworkSnapshot()).toEqual(structuredClone(await server.client.getNetwork()).data);
  });

  it('keeps an unsent local edit over a change from elsewhere, as a whole load does', async () => {
    server = createFakeServer({ versioned: true });
    await startEngine();
    const [first] = server.records('equipment');
    server.goDown();
    renameFirstEquipment('Mine, not sent yet');
    server.comeBack();
    server.editElsewhere('equipment', { ...first, name: 'Theirs' } as { id: string });
    await vi.advanceTimersByTimeAsync(RETRY * 4);
    await idle();
    // Held as a conflict (both kept), never overwritten silently.
    expect(useNetworkStore.getState().equipment[0].name).toBe('Mine, not sent yet');
  });

  it('loads the whole network when the history does not reach back', async () => {
    await startEngine();
    server.forgetHistory();
    server.editElsewhere('cables', { ...server.records('cables')[0], name: 'After a restore' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    expect(server.client.getChanges).toHaveBeenCalled();
    expect(server.client.getNetwork).toHaveBeenCalledTimes(2);
    expect(useNetworkStore.getState().cables[0].name).toBe('After a restore');
  });

  it('with an older server (no change route) it loads the whole network, as before', async () => {
    server = createFakeServer({ incremental: false });
    await startEngine();
    server.editElsewhere('cables', { ...server.records('cables')[0], name: 'Old server' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    expect(server.client.getNetwork).toHaveBeenCalledTimes(2);
    expect(useNetworkStore.getState().cables[0].name).toBe('Old server');
  });

  it('a server that answers the change route with "not found" is asked for the whole network from then on', async () => {
    await startEngine();
    vi.mocked(server.client.getChanges!).mockRejectedValue(new ApiError(404, 'not_found', 'Unknown collection "changes".'));
    server.editElsewhere('cables', { ...server.records('cables')[0], name: 'One' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    server.editElsewhere('cables', { ...server.records('cables')[0], name: 'Two' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    expect(server.client.getChanges).toHaveBeenCalledTimes(1);
    expect(server.client.getNetwork).toHaveBeenCalledTimes(3);
    expect(useNetworkStore.getState().cables[0].name).toBe('Two');
  });
});
